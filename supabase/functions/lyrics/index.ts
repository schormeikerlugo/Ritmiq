// Edge Function: resuelve la letra (sincronizada si existe) de un track
// via lrclib.net. Cache server-side en lyrics_cache para reducir carga
// sobre lrclib (que es publico gratuito mantenido por voluntarios).
//
// Pipeline:
//   1. Hash sha256(artist::title::duration) -> cache_key.
//   2. SELECT lyrics_cache. Si fresh (< 30d si found, < 7d si not found)
//      devuelve payload directo.
//   3. Si miss: GET https://lrclib.net/api/get?artist_name=... (versión exacta).
//      Si no trae tiempos (o no existe), BÚSQUEDA AMPLIA /api/search con el
//      título limpio y se elige la mejor versión SINCRONIZADA (artista/título
//      parecidos, duración más cercana). Prioridad: siempre la sincronizada.
//      a. Con synced o plain -> found=true (+ `duration` de esa versión, para
//         que el cliente sepa si los tiempos cuadran con su audio).
//      b. Nada -> found=false.
//   4. Devuelve payload. Las entradas antiguas (sin `v: 2`) que no tenían
//      tiempos o no se encontraron se consideran caducadas y se rebuscan.
//
// Endpoint:
//   GET /lyrics?artist=<a>&title=<t>&duration=<n>
//   Headers: Authorization: Bearer <user JWT>
//
// Respuesta:
//   {
//     "found": boolean,
//     "synced": "[mm:ss.xx]line\n..." | null,
//     "plain":  "line\n..." | null,
//     "instrumental": boolean,
//     "source": "lrclib",
//     "cached": boolean,
//     "generatedAt": "ISO"
//   }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const LRCLIB_BASE = 'https://lrclib.net/api/get';
const LRCLIB_SEARCH = 'https://lrclib.net/api/search';
const UA = 'Ritmiq/0.2 (https://ritmiq.app)';
const TTL_FOUND_MS = 30 * 86400_000;   // 30 dias para letras sincronizadas
const TTL_PLAIN_MS = 7  * 86400_000;   // 7 dias si solo hay texto (puede aparecer la sincronizada)
const TTL_MISS_MS  = 7  * 86400_000;   // 7 dias para "no encontrada" (puede aparecer despues)
const PAYLOAD_V = 2;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function norm(s: string): string {
  return String(s ?? '').trim().toLowerCase();
}

function isFresh(refreshedAt: string, p: { found?: boolean; synced?: string | null; v?: number }): boolean {
  // Versión anterior sin búsqueda amplia: si no tenía tiempos, rebuscar ya.
  if ((p.v ?? 1) < PAYLOAD_V && !p.synced) return false;
  const elapsed = Date.now() - new Date(refreshedAt).getTime();
  const ttl = !p.found ? TTL_MISS_MS : p.synced ? TTL_FOUND_MS : TTL_PLAIN_MS;
  return elapsed < ttl;
}

/* ── Limpieza y parecido (títulos de YouTube) ─────────────────────── */
const NOISE = /\b(official|oficial|video|v[ií]deo|videoclip|clip|audio|lyrics?|letra|visuali[sz]er|hd|hq|4k|remaster(ed)?|upgrade|mv|explicit|music video|en vivo|live)\b/i;

function simple(s: string): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Artista - Título (Official Video) [4K]" → título limpio. */
function cleanTitle(title: string, artist: string): string {
  let t = String(title ?? '').replace(/[\(\[\{]([^\)\]\}]*)[\)\]\}]/g, (m, inner) =>
    (NOISE.test(inner) || /\b(ft|feat|prod)\b/i.test(inner) || m.startsWith('[') ? ' ' : m));
  t = t.replace(/\s+(ft\.?|feat\.?)\s+.*$/i, '');
  const parts = t.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    const a = simple(artist);
    if (a && simple(parts[0]).includes(a)) t = parts.slice(1).join(' - ');
    else if (a && simple(parts[parts.length - 1]).includes(a)) t = parts.slice(0, -1).join(' - ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

function bigramSim(a: string, b: string): number {
  const A = simple(a); const B = simple(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.9;
  const g = (x: string) => { const o: string[] = []; const y = ` ${x} `; for (let i = 0; i < y.length - 1; i++) o.push(y.slice(i, i + 2)); return o; };
  const ga = g(A); const gb = g(B); const m = new Map<string, number>();
  for (const x of ga) m.set(x, (m.get(x) ?? 0) + 1);
  let hit = 0;
  for (const x of gb) { const c = m.get(x); if (c) { hit++; m.set(x, c - 1); } }
  return (2 * hit) / (ga.length + gb.length);
}

interface LrcLibResponse {
  id?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

interface LrcLibItem extends LrcLibResponse {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
}

/**
 * Búsqueda amplia: mejor versión SINCRONIZADA de la canción.
 * Requisitos: título y artista parecidos; a igualdad, la duración más cercana.
 */
async function searchSynced(artist: string, title: string, duration: number | null): Promise<LrcLibItem | null> {
  const queries = [
    `${LRCLIB_SEARCH}?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`,
    `${LRCLIB_SEARCH}?q=${encodeURIComponent(`${artist} ${title}`)}`,
  ];
  const seen = new Set<number>();
  let best: { item: LrcLibItem; score: number } | null = null;
  for (const u of queries) {
    let items: LrcLibItem[] = [];
    try {
      const r = await fetch(u, { headers: { 'user-agent': UA } });
      if (r.ok) items = await r.json() as LrcLibItem[];
    } catch { /* siguiente */ }
    for (const it of items) {
      if (!it?.syncedLyrics || (it.id && seen.has(it.id))) continue;
      if (it.id) seen.add(it.id);
      const ts = bigramSim(title, it.trackName ?? '');
      const as = bigramSim(artist, it.artistName ?? '');
      if (ts < 0.8 || as < 0.7) continue;
      let score = ts * 0.5 + as * 0.3;
      if (duration && it.duration) {
        const d = Math.abs(duration - it.duration);
        score += d <= 3 ? 0.2 : d <= 8 ? 0.1 : d <= 30 ? 0 : -0.1;
      }
      if (!best || score > best.score) best = { item: it, score };
    }
    if (best && best.score >= 0.95) break;
  }
  return best?.item ?? null;
}

async function fetchFromLrcLib(artist: string, rawTitle: string, duration: number | null): Promise<{
  found: boolean;
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
  duration: number | null;
}> {
  const title = cleanTitle(rawTitle, artist) || rawTitle;
  const exact = await fetchExact(artist, title, duration);
  if (exact.synced || exact.instrumental) return exact;
  // Sin tiempos (o sin nada): buscar una versión sincronizada.
  let alt: LrcLibItem | null = null;
  try { alt = await searchSynced(artist, title, duration); } catch { /* nada */ }
  if (alt?.syncedLyrics) {
    return {
      found: true,
      synced: alt.syncedLyrics,
      plain: alt.plainLyrics ?? exact.plain,
      instrumental: false,
      duration: alt.duration ?? null,
    };
  }
  return exact;
}

async function fetchExact(artist: string, title: string, duration: number | null): Promise<{
  found: boolean;
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
  duration: number | null;
}> {
  const url = new URL(LRCLIB_BASE);
  url.searchParams.set('artist_name', artist);
  url.searchParams.set('track_name', title);
  if (duration && Number.isFinite(duration) && duration > 0) {
    url.searchParams.set('duration', String(Math.round(duration)));
  }
  const res = await fetch(url.toString(), {
    headers: {
      // User-Agent recomendado por lrclib para identificar trafico.
      'user-agent': UA,
    },
  });
  if (res.status === 404) {
    return { found: false, synced: null, plain: null, instrumental: false, duration: null };
  }
  if (!res.ok) {
    throw new Error(`lrclib ${res.status}`);
  }
  const data = await res.json() as LrcLibItem;
  const synced = typeof data?.syncedLyrics === 'string' && data.syncedLyrics.trim()
    ? data.syncedLyrics : null;
  const plain = typeof data?.plainLyrics === 'string' && data.plainLyrics.trim()
    ? data.plainLyrics : null;
  const instrumental = !!data?.instrumental;
  // found si hay algo (synced o plain) o si es instrumental marcado.
  const found = !!(synced || plain || instrumental);
  return { found, synced, plain, instrumental, duration: data?.duration ?? null };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // Validacion minima del Authorization (anti-abuso). lrclib no requiere
  // identidad del user; solo evitamos uso publico sin token Ritmiq.
  if (!req.headers.get('authorization')) {
    return json({ error: 'unauthorized' }, 401);
  }

  const url = new URL(req.url);
  const artist = norm(url.searchParams.get('artist') ?? '');
  const title  = norm(url.searchParams.get('title')  ?? '');
  const durStr = url.searchParams.get('duration');
  const duration = durStr ? parseInt(durStr, 10) : null;

  if (!artist || !title) {
    return json({ error: 'artist y title requeridos' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Cache key: hash de identity normalizada + duration (5s buckets para
  // tolerar pequenos drifts entre fuentes que reportan duracion ligeramente
  // distinta).
  const durBucket = duration ? Math.round(duration / 5) * 5 : 0;
  const cacheKey = await sha256Hex(`${artist}::${title}::${durBucket}`);

  // Lookup cache.
  const { data: cached } = await admin
    .from('lyrics_cache')
    .select('payload, refreshed_at')
    .eq('cache_key', cacheKey)
    .maybeSingle();

  if (cached && cached.payload) {
    const payload = cached.payload as { found?: boolean; synced?: string | null; v?: number };
    if (isFresh(cached.refreshed_at, payload)) {
      return json({
        ...payload,
        cached: true,
        generatedAt: cached.refreshed_at,
      });
    }
  }

  // Fetch fresh de lrclib.
  let result;
  try {
    result = await fetchFromLrcLib(artist, title, duration);
  } catch (err) {
    return json({ error: String((err as Error)?.message ?? err) }, 502);
  }

  const payload = {
    found: result.found,
    synced: result.synced,
    plain: result.plain,
    instrumental: result.instrumental,
    // Duración de la versión elegida: si difiere del audio, los tiempos no
    // cuadran (el servidor la ajusta, ver server-core lyrics-sync).
    duration: result.duration,
    source: 'lrclib',
    v: PAYLOAD_V,
  };

  // Upsert en cache (service_role bypasea RLS).
  try {
    await admin.from('lyrics_cache').upsert({
      cache_key: cacheKey,
      artist,
      title,
      duration_sec: duration,
      payload,
      refreshed_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });
  } catch (err) {
    // No bloqueamos la respuesta si el upsert falla \u2014 el usuario igualmente
    // tendra su letra esta vez.
    console.warn('[lyrics] cache upsert failed:', (err as Error)?.message);
  }

  return json({
    ...payload,
    cached: false,
    generatedAt: new Date().toISOString(),
  });
});
