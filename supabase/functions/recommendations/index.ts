// Edge Function: recomendaciones musicales basadas en Last.fm + búsqueda
// inline en YouTube vía Innertube.
//
// Endpoint:
//   GET /recommendations?kind=<kind>&seed=<seed>
//   Headers: Authorization: Bearer <user JWT>  (necesario para identificar
//            al usuario y leer su historial/biblioteca).
//
// Kinds soportados:
//   similar-artist   → tracks de artistas similares al `seed` (artista).
//   mix-by-track     → tracks similares a `seed=<artist>::<title>`.
//   genre-mix        → tracks top del tag/género `seed` (ej. "reggaeton").
//   discover         → tracks de artistas similares a tus top, que NO están
//                      todavía en tu biblioteca (=descubrimiento).
//
// Estrategia:
//   1. Si hay payload en `recommendation_cache` fresco (<12h), devolverlo.
//   2. Si no:
//      a) Llamar a Last.fm con el método correspondiente.
//      b) Para cada track/artista candidato, buscar en YouTube vía Innertube
//         para obtener `ytId` reproducible.
//      c) Persistir en cache y devolver.
//
// Variables de entorno requeridas (Supabase secrets):
//   LASTFM_API_KEY    — API key de Last.fm (gratis, alta en last.fm/api).
//   SUPABASE_URL      — auto
//   SUPABASE_ANON_KEY — auto
//   SUPABASE_SERVICE_ROLE_KEY — auto

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  isAllowedTag,
  lfm,
  topTagsByArtist,
} from '../_shared/lastfm.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const CACHE_TTL_HOURS = 12;
const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

type Kind = 'similar-artist' | 'mix-by-track' | 'genre-mix' | 'discover' | 'auto-genre-mix';

interface RecTrack {
  ytId: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
  duration: number | null;
  reason?: string;
}

interface Payload {
  kind: Kind;
  seed: string | null;
  tracks: RecTrack[];
  generatedAt: string;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Helpers — Last.fm                                                       */
/* ────────────────────────────────────────────────────────────────────── */
/* lfm(), isAllowedTag, TAG_BLACKLIST, topTagsByArtist viven en
   _shared/lastfm.ts (Fase 7 cleanup). Importados arriba. */

async function similarArtists(artist: string, limit = 8): Promise<Array<{ name: string }>> {
  const j = await lfm('artist.getSimilar', { artist, limit: String(limit), autocorrect: '1' });
  const items = j?.similarartists?.artist ?? [];
  return items.map((x: any) => ({ name: String(x.name) }));
}

async function topTracksByArtist(artist: string, limit = 3): Promise<Array<{ title: string; artist: string }>> {
  const j = await lfm('artist.getTopTracks', { artist, limit: String(limit), autocorrect: '1' });
  const items = j?.toptracks?.track ?? [];
  return items.map((x: any) => ({ title: String(x.name), artist: String(x.artist?.name ?? artist) }));
}

async function similarTracks(artist: string, title: string, limit = 12): Promise<Array<{ title: string; artist: string }>> {
  const j = await lfm('track.getSimilar', { artist, track: title, limit: String(limit), autocorrect: '1' });
  const items = j?.similartracks?.track ?? [];
  return items.map((x: any) => ({ title: String(x.name), artist: String(x.artist?.name ?? artist) }));
}

async function topTracksByTag(tag: string, limit = 12): Promise<Array<{ title: string; artist: string }>> {
  const j = await lfm('tag.getTopTracks', { tag, limit: String(limit) });
  const items = j?.tracks?.track ?? [];
  return items.map((x: any) => ({ title: String(x.name), artist: String(x.artist?.name ?? '') }));
}

/**
 * Obtiene tags de un artista usando la tabla `artist_tags` como cache.
 * Si la tabla no tiene entrada fresca (< 30 días), llama Last.fm y
 * persiste antes de retornar.
 *
 * @param admin   Cliente Supabase con service role (para escribir el cache).
 * @param artist  Nombre del artista.
 */
async function ensureArtistTags(admin: any, artist: string): Promise<string[]> {
  const norm = artist.trim().toLowerCase();
  if (!norm) return [];
  // Lookup cache.
  try {
    const { data: row } = await admin
      .from('artist_tags')
      .select('tags, refreshed_at')
      .eq('artist', norm)
      .maybeSingle();
    if (row && row.refreshed_at) {
      const t = new Date(row.refreshed_at).getTime();
      const fresh = Date.now() - t < 30 * 86400_000;
      if (fresh) return (row.tags ?? []).filter(isAllowedTag);
    }
  } catch (e) {
    console.warn('[recommendations] artist_tags read failed', (e as Error).message);
  }
  // Fetch from Last.fm + persistir.
  const tags = (await topTagsByArtist(artist)).filter(isAllowedTag).slice(0, 5);
  try {
    await admin.from('artist_tags').upsert({
      artist: norm,
      tags,
      refreshed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[recommendations] artist_tags write failed', (e as Error).message);
  }
  return tags;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Helpers — Innertube YouTube search                                       */
/* ────────────────────────────────────────────────────────────────────── */

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

/** Devuelve el PRIMER hit de YouTube para una query. */
async function ytSearchOne(query: string): Promise<RecTrack | null> {
  const body = {
    context: { client: { clientName: 'WEB', clientVersion: '2.20240115.05.00', hl: 'en', gl: 'US' } },
    query,
    params: 'EgIQAQ%3D%3D', // type=video
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
      const title = v.title?.runs?.[0]?.text ?? v.title?.simpleText ?? '';
      const uploader =
        v.ownerText?.runs?.[0]?.text ??
        v.longBylineText?.runs?.[0]?.text ??
        null;
      const durationText = v.lengthText?.simpleText ?? v.lengthText?.runs?.[0]?.text ?? null;
      return {
        ytId: v.videoId,
        title,
        artist: uploader,
        thumbnail: pickThumb(v.thumbnail?.thumbnails),
        duration: parseDuration(durationText),
      };
    }
  }
  return null;
}

/** Busca en paralelo manteniendo el orden. Acepta hasta `concurrency` simultáneos. */
async function ytSearchBatch(
  queries: Array<{ query: string; reason: string }>,
  concurrency = 4
): Promise<RecTrack[]> {
  const out: RecTrack[] = [];
  let i = 0;
  async function worker() {
    while (i < queries.length) {
      const idx = i++;
      const q = queries[idx];
      try {
        const r = await ytSearchOne(q.query);
        if (r) out.push({ ...r, reason: q.reason });
      } catch { /* skip */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, () => worker()));
  // Dedupe por ytId.
  const seen = new Set<string>();
  return out.filter((t) => {
    if (seen.has(t.ytId)) return false;
    seen.add(t.ytId);
    return true;
  });
}

/* ────────────────────────────────────────────────────────────────────── */
/* Cache helpers                                                            */
/* ────────────────────────────────────────────────────────────────────── */

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function cacheKey(userId: string, kind: string, seed: string): Promise<string> {
  return await sha256Hex(`${userId}:${kind}:${seed}`);
}

function cacheIsFresh(refreshedAt: string): boolean {
  const t = new Date(refreshedAt).getTime();
  return Date.now() - t < CACHE_TTL_HOURS * 3600_000;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Generadores por kind                                                     */
/* ────────────────────────────────────────────────────────────────────── */

async function genSimilarArtist(seedArtist: string): Promise<RecTrack[]> {
  const sims = await similarArtists(seedArtist, 10);
  // Para cada artista similar, tomamos su top track.
  const queries = sims.slice(0, 10).map((a) => ({
    query: `${a.name} topic`,
    reason: `Similar a ${seedArtist}`,
  }));
  // Para enriquecer, también pedimos top-tracks reales de Last.fm.
  const enriched: Array<{ query: string; reason: string }> = [];
  for (const a of sims.slice(0, 8)) {
    try {
      const tt = await topTracksByArtist(a.name, 1);
      if (tt[0]) {
        enriched.push({
          query: `${tt[0].artist} ${tt[0].title}`,
          reason: `Similar a ${seedArtist}`,
        });
      }
    } catch {}
  }
  return ytSearchBatch(enriched.length ? enriched : queries, 4);
}

async function genMixByTrack(seedArtist: string, seedTitle: string): Promise<RecTrack[]> {
  const sims = await similarTracks(seedArtist, seedTitle, 12);
  const queries = sims.slice(0, 12).map((t) => ({
    query: `${t.artist} ${t.title}`,
    reason: `Similar a ${seedTitle}`,
  }));
  return ytSearchBatch(queries, 4);
}

async function genGenreMix(tag: string): Promise<RecTrack[]> {
  const top = await topTracksByTag(tag, 16);
  const queries = top.slice(0, 14).map((t) => ({
    query: `${t.artist} ${t.title}`,
    reason: `Top de ${tag}`,
  }));
  return ytSearchBatch(queries, 4);
}

async function genDiscover(
  topArtists: string[],
  knownArtistsLower: Set<string>
): Promise<RecTrack[]> {
  // Para cada uno de los 3 artistas top, traemos 4 similares, filtramos los
  // que el usuario ya conoce, y pedimos un top track de cada.
  const candidates: Array<{ artist: string; from: string }> = [];
  for (const a of topArtists.slice(0, 3)) {
    try {
      const sims = await similarArtists(a, 6);
      for (const s of sims) {
        if (knownArtistsLower.has(s.name.toLowerCase())) continue;
        candidates.push({ artist: s.name, from: a });
        if (candidates.length >= 12) break;
      }
    } catch {}
    if (candidates.length >= 12) break;
  }
  const queries: Array<{ query: string; reason: string }> = [];
  for (const c of candidates.slice(0, 10)) {
    try {
      const tt = await topTracksByArtist(c.artist, 1);
      if (tt[0]) {
        queries.push({
          query: `${tt[0].artist} ${tt[0].title}`,
          reason: `Como ${c.from}, descubre ${c.artist}`,
        });
      }
    } catch {}
  }
  return ytSearchBatch(queries, 4);
}

/* ────────────────────────────────────────────────────────────────────── */
/* Handler                                                                  */
/* ────────────────────────────────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS });

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') as Kind | null;
  const seed = (url.searchParams.get('seed') ?? '').trim();

  if (!kind || !['similar-artist', 'mix-by-track', 'genre-mix', 'discover', 'auto-genre-mix'].includes(kind)) {
    return json({ error: 'kind inválido' }, 400);
  }
  const seedlessKinds = new Set(['discover', 'auto-genre-mix']);
  if (!seedlessKinds.has(kind) && !seed) {
    return json({ error: 'seed requerido para este kind' }, 400);
  }

  // Identificar al usuario desde su JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'no autenticado' }, 401);

  // Service role para cache + lectura de la biblioteca del usuario.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  const key = await cacheKey(user.id, kind, seed);

  // Lookup cache.
  try {
    const { data: cached } = await adminClient
      .from('recommendation_cache')
      .select('payload, refreshed_at')
      .eq('cache_key', key)
      .maybeSingle();
    if (cached && cacheIsFresh(cached.refreshed_at)) {
      return json({ ...(cached.payload as Payload), cached: true });
    }
  } catch (e) {
    console.warn('[recommendations] cache read failed', (e as Error).message);
  }

  // Generar.
  let tracks: RecTrack[] = [];
  try {
    if (kind === 'similar-artist') {
      tracks = await genSimilarArtist(seed);
    } else if (kind === 'mix-by-track') {
      const sep = seed.indexOf('::');
      if (sep < 0) return json({ error: 'seed mix-by-track debe ser "<artist>::<title>"' }, 400);
      const seedArtist = seed.slice(0, sep);
      const seedTitle = seed.slice(sep + 2);
      tracks = await genMixByTrack(seedArtist, seedTitle);
    } else if (kind === 'genre-mix') {
      tracks = await genGenreMix(seed);
    } else if (kind === 'auto-genre-mix') {
      // Deriva el género dominante del usuario:
      //  1. Lee top artistas de play_history (últimos 30 días).
      //  2. Para cada uno trae sus top-tags (cache `artist_tags`).
      //  3. Pondera tags por play count y elige el más frecuente.
      //  4. Genera mix con genre-mix(topTag).
      const { data: hist } = await adminClient
        .from('play_history')
        .select('artist')
        .eq('user_id', user.id)
        .not('artist', 'is', null)
        .gte('played_at', new Date(Date.now() - 30 * 86400_000).toISOString());
      const counts = new Map<string, number>();
      for (const r of hist ?? []) {
        const a = (r.artist ?? '').trim();
        if (!a) continue;
        counts.set(a, (counts.get(a) ?? 0) + 1);
      }
      const topArtists = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (topArtists.length === 0) {
        const empty: Payload = { kind, seed: null, tracks: [], generatedAt: new Date().toISOString() };
        return json(empty);
      }
      const tagScore = new Map<string, number>();
      for (const [artist, plays] of topArtists) {
        const tags = await ensureArtistTags(adminClient, artist);
        for (let i = 0; i < tags.length; i++) {
          // Peso por posición (rank inverso) × plays del artista.
          const w = (tags.length - i) * plays;
          tagScore.set(tags[i], (tagScore.get(tags[i]) ?? 0) + w);
        }
      }
      const ranked = [...tagScore.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length === 0) {
        const empty: Payload = { kind, seed: null, tracks: [], generatedAt: new Date().toISOString() };
        return json(empty);
      }
      const topTag = ranked[0][0];
      tracks = await genGenreMix(topTag);
      const payload: Payload = {
        kind,
        seed: topTag,
        tracks,
        generatedAt: new Date().toISOString(),
      };
      // Persistir cache con seed normalizado.
      try {
        await adminClient.from('recommendation_cache').upsert({
          cache_key: key,
          user_id: user.id,
          kind,
          seed: topTag,
          payload,
          refreshed_at: new Date().toISOString(),
        });
      } catch {}
      return json(payload);
    } else if (kind === 'discover') {
      // Leer top artistas y biblioteca del usuario.
      const { data: hist } = await adminClient
        .from('play_history')
        .select('artist')
        .eq('user_id', user.id)
        .not('artist', 'is', null)
        .gte('played_at', new Date(Date.now() - 30 * 86400_000).toISOString());
      const counts = new Map<string, number>();
      for (const r of hist ?? []) {
        const a = (r.artist ?? '').trim();
        if (!a) continue;
        counts.set(a, (counts.get(a) ?? 0) + 1);
      }
      const topArtists = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
      if (topArtists.length === 0) return json({ kind, seed: null, tracks: [], generatedAt: new Date().toISOString() });
      const { data: lib } = await adminClient
        .from('tracks')
        .select('artist')
        .eq('user_id', user.id)
        .not('artist', 'is', null);
      const known = new Set<string>((lib ?? []).map((t) => String(t.artist).toLowerCase()));
      tracks = await genDiscover(topArtists, known);
    }
  } catch (err) {
    console.error('[recommendations] generación falló', (err as Error).message);
    return json({ error: String((err as Error).message ?? err) }, 502);
  }

  const payload: Payload = {
    kind,
    seed: kind === 'discover' ? null : seed,
    tracks,
    generatedAt: new Date().toISOString(),
  };

  // Persistir cache.
  try {
    await adminClient.from('recommendation_cache').upsert({
      cache_key: key,
      user_id: user.id,
      kind,
      seed: kind === 'discover' ? null : seed,
      payload,
      refreshed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[recommendations] cache write failed', (e as Error).message);
  }

  return json(payload);
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
