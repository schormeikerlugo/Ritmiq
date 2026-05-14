// Edge Function: detalle de artista para la página /artist.
//
// Combina Last.fm (bio, listeners, tags, top tracks, top albums) con
// Innertube (resolver `ytId` de los top tracks para reproducibilidad).
// Los álbumes NO resuelven sus tracks aquí — eso lo hace `album-resolve`
// on-demand cuando el usuario abre o reproduce un álbum.
//
// Endpoint:
//   GET /artist-detail?name=<artista>
//   Headers: Authorization: Bearer <user JWT>
//
// Respuesta:
//   {
//     name, bio, image, tags: string[], listeners: number|null,
//     topTracks: [{title, ytId, thumbnail, duration, playcount}],
//     albums:   [{title, year, coverUrl, trackTitles: string[]}],
//     generatedAt, cached
//   }
//
// Cache: tabla `artist_detail_cache`. TTL 24h.

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

const CACHE_TTL_HOURS = 24;
const MAX_TOP_TRACKS  = 12;
const MAX_ALBUMS      = 30;

/* ── Last.fm helpers ────────────────────────────────────────────────── */

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
  // Buscar la más grande no vacía. Last.fm devuelve placeholders genéricos
  // con `2a96cbd8b46e442fc41c2b86b821562f` en la URL → tratar como null.
  for (const sz of ['mega', 'extralarge', 'large', 'medium']) {
    const it = images.find((x) => x.size === sz);
    const url = it?.['#text'] ?? '';
    if (url && !url.includes('2a96cbd8b46e442fc41c2b86b821562f')) return url;
  }
  return null;
}

/* ── Innertube — buscar ytId para un track conocido ─────────────────── */

interface YtHit { ytId: string; thumbnail: string | null; duration: number | null; }

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

/** Resuelve un batch de tracks a sus ytId en paralelo (concurrencia limitada). */
async function resolveYtBatch(
  tracks: Array<{ artist: string; title: string; playcount?: number }>,
  concurrency = 5
): Promise<Array<{ title: string; artist: string; ytId: string | null; thumbnail: string | null; duration: number | null; playcount: number | null; }>> {
  const out = new Array(tracks.length).fill(null) as any[];
  let i = 0;
  async function worker() {
    while (i < tracks.length) {
      const idx = i++;
      const t = tracks[idx];
      const hit = await ytSearchFirst(`${t.artist} ${t.title}`);
      out[idx] = {
        title: t.title,
        artist: t.artist,
        ytId: hit?.ytId ?? null,
        thumbnail: hit?.thumbnail ?? null,
        duration: hit?.duration ?? null,
        playcount: t.playcount ?? null,
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tracks.length) }, () => worker()));
  return out.filter((x) => x && x.ytId);
}

/* ── Construcción del payload ───────────────────────────────────────── */

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Normaliza un título de álbum para detección de duplicados.
 * Quita variantes "(Deluxe Edition)", "(Remastered)", "(Live)", "[Bonus]",
 * "- 2009 Remaster", " - EP", etc. Las versiones de un mismo álbum aparecen
 * en Last.fm como entradas distintas y con esto las colapsamos a una sola.
 */
function normalizeAlbumTitle(title: string): string {
  let t = title.toLowerCase().trim();
  // Quitar contenido entre paréntesis/corchetes (deluxe, remastered, etc.)
  t = t.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ');
  // Quitar sufijos comunes después de un guión: "- 2009 remaster", "- ep".
  t = t.replace(/\s*[-–—]\s*(deluxe|remaster(ed)?|expanded|anniversary|special|bonus|live|ep|single)[^$]*$/i, '');
  t = t.replace(/\s*[-–—]\s*(19|20)\d{2}.*$/, '');
  // Colapsar espacios.
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/**
 * Dedup de álbumes por título normalizado. Conserva el álbum con mayor
 * playcount de cada grupo (= versión más popular = título canónico).
 * También dedup por coverUrl idéntica para los casos donde el título
 * varía mucho pero la portada es la misma.
 */
function dedupAlbums<T extends { title: string; playcount: number; coverUrl: string | null }>(albums: T[]): T[] {
  const byNorm = new Map<string, T>();
  for (const al of albums) {
    const key = normalizeAlbumTitle(al.title);
    if (!key) continue;
    const cur = byNorm.get(key);
    if (!cur || al.playcount > cur.playcount) {
      byNorm.set(key, al);
    }
  }
  // Segundo paso: dedup por cover URL idéntica (cuando Last.fm devuelve
  // distintos títulos para la misma reedición).
  const byCover = new Map<string, T>();
  const out: T[] = [];
  for (const al of byNorm.values()) {
    if (al.coverUrl) {
      const existing = byCover.get(al.coverUrl);
      if (existing) {
        if (al.playcount > existing.playcount) {
          // Reemplazamos al de menor playcount.
          const idx = out.indexOf(existing);
          if (idx >= 0) out[idx] = al;
          byCover.set(al.coverUrl, al);
        }
        continue;
      }
      byCover.set(al.coverUrl, al);
    }
    out.push(al);
  }
  // Orden final por playcount descendente.
  return out.sort((a, b) => b.playcount - a.playcount);
}

function cacheIsFresh(refreshedAt: string): boolean {
  return Date.now() - new Date(refreshedAt).getTime() < CACHE_TTL_HOURS * 3600_000;
}

async function buildArtistDetail(artistName: string) {
  // 1. info + tags
  const info = await lfm('artist.getInfo', { artist: artistName, autocorrect: '1' }).catch(() => null);
  const a = info?.artist ?? {};
  const name = a?.name ?? artistName;
  const bio = (a?.bio?.summary ?? '').replace(/<a[^>]*>.*?<\/a>/g, '').trim();
  const listeners = Number(a?.stats?.listeners ?? 0) || null;
  const tags: string[] = (a?.tags?.tag ?? []).map((t: any) => String(t.name).toLowerCase()).slice(0, 5);
  let image = pickLfmImage(a?.image);

  // 2. top tracks
  let topTracks: Array<{ title: string; artist: string; ytId: string | null; thumbnail: string | null; duration: number | null; playcount: number | null }> = [];
  try {
    const tt = await lfm('artist.getTopTracks', { artist: artistName, limit: String(MAX_TOP_TRACKS), autocorrect: '1' });
    const items = tt?.toptracks?.track ?? [];
    const candidates = items.slice(0, MAX_TOP_TRACKS).map((x: any) => ({
      title: String(x.name),
      artist: String(x.artist?.name ?? name),
      playcount: Number(x.playcount) || 0,
    }));
    topTracks = await resolveYtBatch(candidates, 5);
  } catch (e) {
    console.warn('[artist-detail] topTracks failed', (e as Error).message);
  }

  // Fallback de imagen del artista: cover del primer top track si Last.fm
  // devolvió placeholder genérico (común desde 2019).
  if (!image && topTracks[0]?.thumbnail) image = topTracks[0].thumbnail;

  // 3. álbumes (sin resolver tracks aún)
  let albums: Array<{ title: string; year: number | null; coverUrl: string | null; trackCount: number | null }> = [];
  try {
    const ta = await lfm('artist.getTopAlbums', { artist: artistName, limit: String(MAX_ALBUMS * 2), autocorrect: '1' });
    const items = ta?.topalbums?.album ?? [];
    const raw = items
      .map((x: any) => ({
        title: String(x.name ?? '').trim(),
        coverUrl: pickLfmImage(x.image),
        year: null,
        trackCount: null,
        playcount: Number(x.playcount) || 0,
      }))
      .filter((al: any) => al.title && al.title.toLowerCase() !== '(null)');
    albums = dedupAlbums(raw).slice(0, MAX_ALBUMS);
  } catch (e) {
    console.warn('[artist-detail] topAlbums failed', (e as Error).message);
  }

  return {
    name,
    bio,
    image,
    tags,
    listeners,
    topTracks,
    albums,
    generatedAt: new Date().toISOString(),
  };
}

/* ── Handler ─────────────────────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS });

  const url = new URL(req.url);
  const artistRaw = (url.searchParams.get('name') ?? '').trim();
  if (!artistRaw) return json({ error: 'name requerido' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const norm = normalizeName(artistRaw);

  // Lookup cache.
  try {
    const { data: cached } = await admin
      .from('artist_detail_cache')
      .select('payload, refreshed_at')
      .eq('name', norm)
      .maybeSingle();
    if (cached && cacheIsFresh(cached.refreshed_at)) {
      return json({ ...(cached.payload as any), cached: true });
    }
  } catch (e) {
    console.warn('[artist-detail] cache read failed', (e as Error).message);
  }

  // Construir.
  try {
    const payload = await buildArtistDetail(artistRaw);
    try {
      await admin.from('artist_detail_cache').upsert({
        name: norm,
        payload,
        refreshed_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[artist-detail] cache write failed', (e as Error).message);
    }
    return json({ ...payload, cached: false });
  } catch (err) {
    console.error('[artist-detail] failed', (err as Error).message);
    return json({ error: String((err as Error).message ?? err) }, 502);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
