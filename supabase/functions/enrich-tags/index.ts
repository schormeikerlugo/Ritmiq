// Edge Function: enriquece la tabla `artist_tags` con los top-tags de
// Last.fm para un batch de artistas. Diseñada para:
//
//   1. Pre-popular el cache cuando un usuario importa una biblioteca
//      grande (ej. via Spotify Import) → sus filas Home con auto-genre-mix
//      tienen tags al primer load.
//
//   2. Cron job nocturno que mantenga `artist_tags` fresco para los top
//      artistas activos (TTL 30d).
//
//   3. Trigger manual desde el cliente cuando el usuario abre Stats o
//      llega al fold del Home, para acelerar la próxima carga.
//
// Endpoint:
//   POST /enrich-tags
//   Headers: Authorization: Bearer <user JWT>
//   Body: { artists: string[] }   // max 50 artistas por request
//
// Respuesta:
//   {
//     enriched: number,    // cuántos artistas tienen tags ahora
//     cached: number,      // ya estaban frescos en artist_tags
//     fetched: number,     // se llamó a Last.fm
//     failed: string[],    // artistas que Last.fm no resolvió
//     generatedAt: string,
//   }
//
// Concurrencia: 5 artistas en paralelo para no exceder rate limit Last.fm
// (5 req/s). Si llegan 50, tarda ~10s.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const CACHE_TTL_MS = 30 * 86400_000;
const MAX_ARTISTS_PER_REQUEST = 50;
const CONCURRENCY = 5;
const MAX_TAGS_PER_ARTIST = 5;

const TAG_BLACKLIST = new Set<string>([
  'seen live', 'awesome', 'favorite', 'favourite', 'favorites', 'favourites',
  'all', 'albums i own', 'tracks i own', 'love at first listen',
  'male vocalists', 'female vocalists', 'male vocalist', 'female vocalist',
  'cool', 'great', 'amazing', 'best', 'good', 'beautiful', 'epic',
  'classic', 'masterpiece', 'spotify',
]);

function isAllowedTag(tag: string): boolean {
  const t = tag.toLowerCase().trim();
  if (TAG_BLACKLIST.has(t)) return false;
  if (/^\d{2,4}s?$/.test(t)) return false;
  if (/^(19|20)\d{2}$/.test(t)) return false;
  if (t.length < 3) return false;
  return true;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

async function lfm(method: string, params: Record<string, string>): Promise<any> {
  const apiKey = Deno.env.get('LASTFM_API_KEY');
  if (!apiKey) throw new Error('LASTFM_API_KEY no configurada');
  const url = new URL(LASTFM_BASE);
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`lastfm ${method} ${r.status}`);
  return r.json();
}

async function topTagsByArtist(artist: string): Promise<string[]> {
  try {
    const j = await lfm('artist.getTopTags', { artist, autocorrect: '1' });
    const items = j?.toptags?.tag ?? [];
    return items.slice(0, 10).map((x: any) => String(x.name).toLowerCase());
  } catch {
    return [];
  }
}

/** Resuelve y persiste los tags de un único artista. */
async function enrichOne(admin: any, artist: string): Promise<{
  status: 'cached' | 'fetched' | 'failed',
  tags: string[],
}> {
  const norm = artist.trim().toLowerCase();
  if (!norm) return { status: 'failed', tags: [] };

  // Lookup cache.
  try {
    const { data: row } = await admin
      .from('artist_tags')
      .select('tags, refreshed_at')
      .eq('artist', norm)
      .maybeSingle();
    if (row?.refreshed_at) {
      const fresh = Date.now() - new Date(row.refreshed_at).getTime() < CACHE_TTL_MS;
      if (fresh) {
        return { status: 'cached', tags: (row.tags ?? []).filter(isAllowedTag) };
      }
    }
  } catch (e) {
    console.warn('[enrich-tags] cache read failed:', (e as Error).message);
  }

  // Fetch + persist.
  const rawTags = await topTagsByArtist(artist);
  const filtered = rawTags.filter(isAllowedTag).slice(0, MAX_TAGS_PER_ARTIST);

  if (filtered.length === 0) {
    // Persistimos vacío para no reintentar inmediatamente. TTL aplica
    // igual; si el artista gana tags en Last.fm, se refresca tras 30d.
    try {
      await admin.from('artist_tags').upsert({
        artist: norm,
        tags: [],
        refreshed_at: new Date().toISOString(),
      });
    } catch {}
    return { status: 'failed', tags: [] };
  }

  try {
    await admin.from('artist_tags').upsert({
      artist: norm,
      tags: filtered,
      refreshed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[enrich-tags] cache write failed:', (e as Error).message);
  }

  return { status: 'fetched', tags: filtered };
}

/** Procesa un array de artistas con concurrencia limitada. */
async function enrichBatch(admin: any, artists: string[]): Promise<{
  enriched: number,
  cached: number,
  fetched: number,
  failed: string[],
}> {
  let cached = 0;
  let fetched = 0;
  let enriched = 0;
  const failed: string[] = [];

  // Pool worker pattern: arrancamos CONCURRENCY tasks que consumen del
  // queue compartido `nextIdx`. Mantiene 5 calls en flight sin overshoot.
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= artists.length) return;
      const a = artists[i];
      const result = await enrichOne(admin, a);
      if (result.status === 'cached') {
        cached++;
        enriched++;
      } else if (result.status === 'fetched') {
        fetched++;
        if (result.tags.length > 0) enriched++;
        else failed.push(a);
      } else {
        failed.push(a);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return { enriched, cached, fetched, failed };
}

/* ── Handler ───────────────────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!req.headers.get('authorization')) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const artistsRaw = body?.artists;
  if (!Array.isArray(artistsRaw)) {
    return json({ error: 'artists requerido (array de strings)' }, 400);
  }

  // Deduplicar + filtrar vacíos + clamp.
  const seen = new Set<string>();
  const artists: string[] = [];
  for (const a of artistsRaw) {
    if (typeof a !== 'string') continue;
    const k = a.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    artists.push(a.trim());
    if (artists.length >= MAX_ARTISTS_PER_REQUEST) break;
  }

  if (artists.length === 0) {
    return json({
      enriched: 0,
      cached: 0,
      fetched: 0,
      failed: [],
      generatedAt: new Date().toISOString(),
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const result = await enrichBatch(admin, artists);

  return json({
    ...result,
    generatedAt: new Date().toISOString(),
  });
});
