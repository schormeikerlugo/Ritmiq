// Edge Function: resuelve una playlist publica de YouTube a una lista de
// tracks reproducibles. Llamada via Innertube `browse` con browseId=VL<playlistId>.
//
// Pipeline:
//   1. Validar JWT del usuario (mismo patron que recommendations).
//   2. Llamar a Innertube browse para obtener el listado.
//   3. Extraer items reproducibles {ytId, title, artist, thumbnail, duration}.
//   4. Devolver payload + metadata de la playlist.
//
// Sin cache server-side por ahora: el cliente (useYtPlaylistStore) cachea en
// memoria por sesion. Las playlists YT del search son menos frecuentes que
// los albums; si se vuelve hot path, agregar tabla `yt_playlist_cache` con
// TTL 24h similar a album_resolve_cache.
//
// Endpoint:
//   GET /yt-playlist-resolve?id=<playlistId>
//   Headers: Authorization: Bearer <user JWT>
//
// Respuesta:
//   {
//     id, title, author, coverUrl,
//     tracks: [{ ytId, title, artist, thumbnail, duration }],
//     generatedAt
//   }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

/** Cuerpo minimo del client Innertube web. */
function innertubeBody(browseId: string) {
  return {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240101.00.00',
        hl: 'en',
        gl: 'US',
      },
    },
    browseId,
  };
}

/** Convierte "3:42" o "1:02:33" a segundos. */
function parseDuration(text: string | undefined | null): number | null {
  if (!text) return null;
  const parts = String(text).split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

/** Texto de un nodo Innertube `{ runs: [...] }` o `{ simpleText: '' }`. */
function nodeText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node?.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node?.runs)) {
    return node.runs.map((r: any) => r?.text ?? '').join('');
  }
  return '';
}

/** Best-effort: extrae el thumbnail mas grande de un nodo `thumbnail`. */
function pickThumbnail(thumb: any): string | null {
  const list = thumb?.thumbnails ?? [];
  if (!Array.isArray(list) || list.length === 0) return null;
  const sorted = list.slice().sort((a: any, b: any) => (b?.width ?? 0) - (a?.width ?? 0));
  return sorted[0]?.url ?? null;
}

interface PlaylistTrack {
  ytId: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
  duration: number | null;
}

function extractTracks(data: any): PlaylistTrack[] {
  const tracks: PlaylistTrack[] = [];
  // Path principal: contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer
  //   .content.sectionListRenderer.contents[0].itemSectionRenderer
  //   .contents[0].playlistVideoListRenderer.contents[]
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
  for (const tab of tabs) {
    const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
    for (const sec of sections) {
      const items = sec?.itemSectionRenderer?.contents ?? [];
      for (const item of items) {
        const list = item?.playlistVideoListRenderer?.contents ?? [];
        for (const entry of list) {
          const v = entry?.playlistVideoRenderer;
          if (!v?.videoId) continue;
          const title = nodeText(v?.title) || '';
          if (!title) continue;
          // El artista viene en shortBylineText (canal del video). Para
          // playlists oficiales de artista esto es el artista real.
          const artist = nodeText(v?.shortBylineText) || null;
          const thumbnail = pickThumbnail(v?.thumbnail);
          const lengthSec = v?.lengthSeconds
            ? parseInt(v.lengthSeconds, 10)
            : parseDuration(nodeText(v?.lengthText));
          tracks.push({
            ytId: v.videoId,
            title,
            artist,
            thumbnail,
            duration: Number.isFinite(lengthSec) ? lengthSec : null,
          });
        }
      }
    }
  }
  return tracks;
}

function extractMetadata(data: any): { title: string; author: string | null; coverUrl: string | null } {
  // sidebar.playlistSidebarRenderer.items[0].playlistSidebarPrimaryInfoRenderer
  const sidebarItems = data?.sidebar?.playlistSidebarRenderer?.items ?? [];
  let title = '';
  let author: string | null = null;
  let coverUrl: string | null = null;

  for (const it of sidebarItems) {
    const primary = it?.playlistSidebarPrimaryInfoRenderer;
    if (primary) {
      title = nodeText(primary?.title) || title;
      coverUrl = pickThumbnail(primary?.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail)
              || pickThumbnail(primary?.thumbnailRenderer?.playlistCustomThumbnailRenderer?.thumbnail)
              || coverUrl;
    }
    const secondary = it?.playlistSidebarSecondaryInfoRenderer;
    if (secondary) {
      const owner = secondary?.videoOwner?.videoOwnerRenderer?.title;
      if (owner) author = nodeText(owner) || author;
    }
  }

  // Fallback al metadata top-level si el sidebar no devolvio nada.
  if (!title) {
    title = nodeText(data?.metadata?.playlistMetadataRenderer?.title) || 'Playlist';
  }

  return { title, author, coverUrl };
}

/* ── Handler ───────────────────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const id = (url.searchParams.get('id') ?? '').trim();
  if (!id) {
    return new Response(JSON.stringify({ error: 'id requerido' }), {
      status: 400,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  // Validacion minima del JWT. La edge function se llama autenticada via
  // VITE_SUPABASE_ANON_KEY + Bearer del user. No bloqueamos por validez
  // estricta del JWT \u2014 Innertube no requiere identidad del user. Solo
  // garantizamos que la peticion venga con un Authorization para evitar
  // abuso publico.
  if (!req.headers.get('authorization')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  // browseId para playlists publicas es 'VL' + playlistId.
  const browseId = id.startsWith('VL') ? id : `VL${id}`;

  let data: any;
  try {
    const res = await fetch(`${INNERTUBE_URL}&key=${INNERTUBE_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(innertubeBody(browseId)),
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `innertube ${res.status}` }), {
        status: 502,
        headers: { ...CORS, 'content-type': 'application/json' },
      });
    }
    data = await res.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message ?? err) }), {
      status: 502,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  const tracks = extractTracks(data);
  if (tracks.length === 0) {
    return new Response(JSON.stringify({ error: 'playlist sin tracks reproducibles' }), {
      status: 404,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  const { title, author, coverUrl } = extractMetadata(data);

  return new Response(JSON.stringify({
    id,
    title,
    author,
    coverUrl: coverUrl ?? tracks[0]?.thumbnail ?? null,
    tracks,
    generatedAt: new Date().toISOString(),
  }), {
    status: 200,
    headers: {
      ...CORS,
      'content-type': 'application/json',
      'cache-control': 'public, max-age=600',
    },
  });
});
