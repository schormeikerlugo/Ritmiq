// Edge Function: resuelve la letra (sincronizada si existe) de un track
// via lrclib.net. Cache server-side en lyrics_cache para reducir carga
// sobre lrclib (que es publico gratuito mantenido por voluntarios).
//
// Pipeline:
//   1. Hash sha256(artist::title::duration) -> cache_key.
//   2. SELECT lyrics_cache. Si fresh (< 30d si found, < 7d si not found)
//      devuelve payload directo.
//   3. Si miss: GET https://lrclib.net/api/get?artist_name=...
//      a. Si 200 con syncedLyrics o plainLyrics -> persiste found=true.
//      b. Si 404 o sin lyrics -> persiste found=false (mejor que no-op
//         porque el usuario no veria el spinner si volvemos a buscar).
//   4. Devuelve payload.
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
const TTL_FOUND_MS = 30 * 86400_000;   // 30 dias para letras encontradas
const TTL_MISS_MS  = 7  * 86400_000;   // 7 dias para "no encontrada" (puede aparecer despues)

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

function isFresh(refreshedAt: string, found: boolean): boolean {
  const elapsed = Date.now() - new Date(refreshedAt).getTime();
  const ttl = found ? TTL_FOUND_MS : TTL_MISS_MS;
  return elapsed < ttl;
}

interface LrcLibResponse {
  id?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

async function fetchFromLrcLib(artist: string, title: string, duration: number | null): Promise<{
  found: boolean;
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
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
      'user-agent': 'Ritmiq/0.1 (https://ritmiq.app)',
    },
  });
  if (res.status === 404) {
    return { found: false, synced: null, plain: null, instrumental: false };
  }
  if (!res.ok) {
    throw new Error(`lrclib ${res.status}`);
  }
  const data = await res.json() as LrcLibResponse;
  const synced = typeof data?.syncedLyrics === 'string' && data.syncedLyrics.trim()
    ? data.syncedLyrics : null;
  const plain = typeof data?.plainLyrics === 'string' && data.plainLyrics.trim()
    ? data.plainLyrics : null;
  const instrumental = !!data?.instrumental;
  // found si hay algo (synced o plain) o si es instrumental marcado.
  const found = !!(synced || plain || instrumental);
  return { found, synced, plain, instrumental };
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
    const payload = cached.payload as { found?: boolean };
    if (isFresh(cached.refreshed_at, !!payload.found)) {
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
    source: 'lrclib',
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
