// Edge Function: resuelve un álbum (artista + nombre) a una lista de
// tracks reproducibles {title, ytId, duration, thumbnail}.
//
// Pipeline:
//   1. Cache lookup en `album_resolve_cache` (TTL 7 días).
//   2. Si miss: Last.fm `album.getInfo` → tracklist + coverArt + year.
//   3. Para cada track, Innertube `<artist> <title>` → primer hit.
//   4. Persistir en cache.
//
// Endpoint:
//   GET /album-resolve?artist=<a>&album=<b>
//   Headers: Authorization: Bearer <user JWT>
//
// Respuesta:
//   {
//     artist, album, year, coverUrl,
//     tracks: [{ title, ytId, thumbnail, duration }],
//     generatedAt, cached
//   }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const CACHE_TTL_DAYS = 7;

/* ── Helpers ───────────────────────────────────────────────────────── */

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function lfm(method: string, params: Record<string, string>): Promise<any> {
  const apiKey = Deno.env.get('LASTFM_API_KEY');
  if (!apiKey) throw new Error('LASTFM_API_KEY no configurada');
  const url = new URL(LASTFM_BASE);
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), { headers: { 'User-Agent': 'Ritmiq/0.1' } });
  if (!r.ok) throw new Error(`lastfm ${method} ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`lastfm ${method}: ${j.message}`);
  return j;
}

function pickLfmImage(images: any[] | undefined): string | null {
  if (!Array.isArray(images)) return null;
  for (const sz of ['mega', 'extralarge', 'large']) {
    const it = images.find((x) => x.size === sz);
    const url = it?.['#text'] ?? '';
    if (url && !url.includes('2a96cbd8b46e442fc41c2b86b821562f')) return url;
  }
  return null;
}

function parseDuration(text: string | undefined | null): number | null {
  if (!text) return null;
  const parts = text.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function pickThumb(thumbs: Array<{ url?: string }> | undefined): string | null {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
  return thumbs[thumbs.length - 1]?.url ?? null;
}

interface YtHit { ytId: string; thumbnail: string | null; duration: number | null; }

async function ytSearchFirst(query: string): Promise<YtHit | null> {
  try {
    const body = {
      context: { client: { clientName: 'WEB', clientVersion: '2.20240115.05.00', hl: 'en', gl: 'US' } },
      query,
      params: 'EgIQAQ%3D%3D',
    };
    const r = await fetch(`${INNERTUBE_URL}&key=${INNERTUBE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const sections = j?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
    for (const sec of sections) {
      const items = sec?.itemSectionRenderer?.contents ?? [];
      for (const it of items) {
        const v = it?.videoRenderer;
        if (!v?.videoId) continue;
        return {
          ytId: v.videoId,
          thumbnail: pickThumb(v.thumbnail?.thumbnails),
          duration: parseDuration(v.lengthText?.simpleText ?? v.lengthText?.runs?.[0]?.text ?? null),
        };
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function resolveBatch(
  tracks: Array<{ title: string; artist: string }>,
  concurrency = 4
): Promise<Array<{ title: string; artist: string; ytId: string; thumbnail: string | null; duration: number | null }>> {
  const out = new Array(tracks.length).fill(null) as any[];
  let i = 0;
  async function worker() {
    while (i < tracks.length) {
      const idx = i++;
      const t = tracks[idx];
      const hit = await ytSearchFirst(`${t.artist} ${t.title}`);
      if (hit?.ytId) {
        out[idx] = { title: t.title, artist: t.artist, ytId: hit.ytId, thumbnail: hit.thumbnail, duration: hit.duration };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tracks.length) }, () => worker()));
  return out.filter(Boolean);
}

function cacheIsFresh(refreshedAt: string): boolean {
  return Date.now() - new Date(refreshedAt).getTime() < CACHE_TTL_DAYS * 86400_000;
}

/**
 * Last.fm `wiki.published` viene como "1 January 1994, 12:00am" o
 * "1 Jan 1994, 12:00am" o similares. Extraemos el año con regex.
 */
function extractYear(published: string | undefined | null): number | null {
  if (!published) return null;
  const m = String(published).match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

async function buildAlbum(artist: string, album: string) {
  const info = await lfm('album.getInfo', { artist, album, autocorrect: '1' });
  const a = info?.album ?? {};
  const realArtist = a?.artist ?? artist;
  const realName   = a?.name ?? album;
  const coverUrl   = pickLfmImage(a?.image);
  const year       = extractYear(a?.wiki?.published);

  const tracklist: Array<any> = a?.tracks?.track ?? [];
  // Last.fm a veces devuelve un objeto en vez de array si hay 1 track.
  const normalizedTracks = Array.isArray(tracklist) ? tracklist : [tracklist];

  const queries = normalizedTracks
    .filter((t) => t?.name)
    .map((t) => ({ title: String(t.name), artist: realArtist }));

  const tracks = await resolveBatch(queries, 4);

  return {
    artist: realArtist,
    album: realName,
    year,
    coverUrl,
    tracks,
    generatedAt: new Date().toISOString(),
  };
}

/* ── Handler ───────────────────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS });

  const url = new URL(req.url);
  const artist = (url.searchParams.get('artist') ?? '').trim();
  const album  = (url.searchParams.get('album') ?? '').trim();
  if (!artist || !album) return json({ error: 'artist y album requeridos' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const normA = artist.toLowerCase();
  const normB = album.toLowerCase();
  const key = await sha256Hex(`${normA}::${normB}`);

  // Cache.
  try {
    const { data: cached } = await admin
      .from('album_resolve_cache')
      .select('payload, refreshed_at')
      .eq('cache_key', key)
      .maybeSingle();
    if (cached && cacheIsFresh(cached.refreshed_at)) {
      return json({ ...(cached.payload as any), cached: true });
    }
  } catch (e) {
    console.warn('[album-resolve] cache read failed', (e as Error).message);
  }

  try {
    const payload = await buildAlbum(artist, album);
    try {
      await admin.from('album_resolve_cache').upsert({
        cache_key: key,
        artist: normA,
        album: normB,
        payload,
        refreshed_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[album-resolve] cache write failed', (e as Error).message);
    }
    return json({ ...payload, cached: false });
  } catch (err) {
    console.error('[album-resolve] failed', (err as Error).message);
    return json({ error: String((err as Error).message ?? err) }, 502);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
