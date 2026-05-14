// Edge Function: búsqueda en YouTube vía la API interna Innertube.
//
// Endpoints soportados:
//   GET /search-youtube?q=<query>&max=12              → solo videos (compat)
//   GET /search-youtube?q=<query>&type=videos&max=20  → solo videos
//   GET /search-youtube?q=<query>&type=channels       → solo canales (artistas)
//   GET /search-youtube?q=<query>&type=playlists      → solo playlists
//   GET /search-youtube?q=<query>&type=all            → 5 de cada tipo
//
// Respuesta:
//   - type=videos|channels|playlists → { items: [...] }   (compat)
//   - type=all → { videos:[], channels:[], playlists:[] }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

// Innertube `params` URL-encoded para filtrar por tipo. Estos códigos
// vienen del web client de YouTube — son estables hace varios años.
//   EgIQAQ%3D%3D → videos
//   EgIQAg%3D%3D → canales (= artistas)
//   EgIQAw%3D%3D → playlists
const TYPE_PARAMS: Record<string, string> = {
  videos:    'EgIQAQ%3D%3D',
  channels:  'EgIQAg%3D%3D',
  playlists: 'EgIQAw%3D%3D',
};

interface VideoItem {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
}
interface ChannelItem {
  id: string;          // channelId
  title: string;       // nombre del canal/artista
  subscribers: string | null;
  thumbnail: string | null;
}
interface PlaylistItem {
  id: string;          // playlistId
  title: string;
  videoCount: number | null;
  thumbnail: string | null;
  author: string | null;
}

function pickThumb(thumbs: Array<{ url?: string }> | undefined): string | null {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
  return thumbs[thumbs.length - 1]?.url ?? null;
}

function parseDuration(text: string | undefined | null): number | null {
  if (!text) return null;
  const parts = text.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function parseVideoCount(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d[\d,.]*)/);
  if (!m) return null;
  return parseInt(m[1].replace(/[,.]/g, ''), 10);
}

async function callInnertube(query: string, params: string | null): Promise<any> {
  const body: any = {
    context: {
      client: { clientName: 'WEB', clientVersion: '2.20240115.05.00', hl: 'en', gl: 'US' },
    },
    query,
  };
  if (params) body.params = params;
  const res = await fetch(`${INNERTUBE_URL}&key=${INNERTUBE_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Innertube ${res.status}`);
  return res.json();
}

/** Itera secciones de search.contents.* y extrae renderers de cada tipo. */
function extractItems(data: any) {
  const videos: VideoItem[] = [];
  const channels: ChannelItem[] = [];
  const playlists: PlaylistItem[] = [];
  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents ?? [];

  for (const section of sections) {
    const contents = section?.itemSectionRenderer?.contents ?? [];
    for (const it of contents) {
      if (it?.videoRenderer) {
        const v = it.videoRenderer;
        if (!v.videoId) continue;
        videos.push({
          id: v.videoId,
          title: v.title?.runs?.[0]?.text ?? v.title?.simpleText ?? '',
          uploader:
            v.ownerText?.runs?.[0]?.text ??
            v.longBylineText?.runs?.[0]?.text ??
            null,
          duration: parseDuration(
            v.lengthText?.simpleText ?? v.lengthText?.runs?.[0]?.text ?? null
          ),
          thumbnail: pickThumb(v.thumbnail?.thumbnails),
        });
      } else if (it?.channelRenderer) {
        const c = it.channelRenderer;
        if (!c.channelId) continue;
        channels.push({
          id: c.channelId,
          title: c.title?.simpleText ?? c.title?.runs?.[0]?.text ?? '',
          subscribers:
            c.videoCountText?.simpleText ??
            c.subscriberCountText?.simpleText ??
            null,
          thumbnail: pickThumb(c.thumbnail?.thumbnails),
        });
      } else if (it?.playlistRenderer) {
        const p = it.playlistRenderer;
        if (!p.playlistId) continue;
        playlists.push({
          id: p.playlistId,
          title: p.title?.simpleText ?? p.title?.runs?.[0]?.text ?? '',
          videoCount: parseVideoCount(p.videoCountText?.runs?.[0]?.text ?? p.videoCountShortText?.simpleText ?? null),
          thumbnail: pickThumb(p.thumbnails?.[0]?.thumbnails ?? p.thumbnail?.thumbnails),
          author: p.shortBylineText?.runs?.[0]?.text ?? p.longBylineText?.runs?.[0]?.text ?? null,
        });
      }
      // radioRenderer y showRenderer ignorados por ahora.
    }
  }
  return { videos, channels, playlists };
}

async function searchOneType(query: string, type: keyof typeof TYPE_PARAMS, max: number) {
  const data = await callInnertube(query, TYPE_PARAMS[type]);
  const { videos, channels, playlists } = extractItems(data);
  if (type === 'videos') return { items: videos.slice(0, max) };
  if (type === 'channels') return { items: channels.slice(0, max) };
  return { items: playlists.slice(0, max) };
}

async function searchAll(query: string, perType: number) {
  // 3 búsquedas paralelas, una por tipo.
  const [videosRes, channelsRes, playlistsRes] = await Promise.allSettled([
    callInnertube(query, TYPE_PARAMS.videos).then((d) => extractItems(d).videos.slice(0, perType)),
    callInnertube(query, TYPE_PARAMS.channels).then((d) => extractItems(d).channels.slice(0, perType)),
    callInnertube(query, TYPE_PARAMS.playlists).then((d) => extractItems(d).playlists.slice(0, perType)),
  ]);
  return {
    videos:   videosRes.status === 'fulfilled' ? videosRes.value : [],
    channels: channelsRes.status === 'fulfilled' ? channelsRes.value : [],
    playlists: playlistsRes.status === 'fulfilled' ? playlistsRes.value : [],
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS });

  const url = new URL(req.url);
  const query = url.searchParams.get('q') ?? '';
  const type = (url.searchParams.get('type') ?? 'videos').toLowerCase();
  const max = Math.min(30, Math.max(1, parseInt(url.searchParams.get('max') ?? '12', 10)));

  if (!query.trim()) {
    return new Response(JSON.stringify({ error: 'q required' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    let payload: unknown;
    if (type === 'all') {
      payload = await searchAll(query, 5);
    } else if (type in TYPE_PARAMS) {
      payload = await searchOneType(query, type as keyof typeof TYPE_PARAMS, max);
    } else {
      return new Response(JSON.stringify({ error: 'type inválido' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(payload), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[search-youtube]', err);
    return new Response(
      JSON.stringify({ error: String((err as Error)?.message ?? err) }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
