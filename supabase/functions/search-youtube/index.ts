// Edge Function: búsqueda en YouTube vía la API interna Innertube.
//
// Llamamos directamente al endpoint público que usa el frontend de YouTube,
// sin necesidad de librerías pesadas (que tienden a romperse en Deno Edge
// Runtime con cold-start) ni de YOUTUBE_API_KEY.
//
// Endpoint:
//   GET /search-youtube?q=<query>&max=12
//   Response: { items: [{id,title,uploader,duration,thumbnail}, ...] }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // clave pública del web client

interface Item {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
}

function pickThumb(thumbs: Array<{ url?: string }> | undefined): string | null {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
  return thumbs[thumbs.length - 1]?.url ?? null;
}

/** Convierte "3:42" o "1:02:30" a segundos. */
function parseDuration(text: string | undefined): number | null {
  if (!text) return null;
  const parts = text.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

async function searchInnertube(query: string, max: number): Promise<Item[]> {
  const body = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240115.05.00',
        hl: 'en',
        gl: 'US',
      },
    },
    query,
    // EgIQAQ%3D%3D filtra por type=video
    params: 'EgIQAQ%3D%3D',
  };

  const res = await fetch(`${INNERTUBE_URL}&key=${INNERTUBE_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Innertube ${res.status}`);
  const data = await res.json();

  // Estructura: contents.twoColumnSearchResultsRenderer.primaryContents
  //             .sectionListRenderer.contents[].itemSectionRenderer.contents[].videoRenderer
  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents ?? [];

  const items: Item[] = [];
  for (const section of sections) {
    const itemContents = section?.itemSectionRenderer?.contents ?? [];
    for (const it of itemContents) {
      if (items.length >= max) break;
      const v = it?.videoRenderer;
      if (!v?.videoId) continue;

      const title = v.title?.runs?.[0]?.text ?? v.title?.simpleText ?? '';
      const uploader =
        v.ownerText?.runs?.[0]?.text ??
        v.longBylineText?.runs?.[0]?.text ??
        null;
      const durationText =
        v.lengthText?.simpleText ??
        v.lengthText?.runs?.[0]?.text ??
        null;
      const thumbnail = pickThumb(v.thumbnail?.thumbnails);

      items.push({
        id: v.videoId,
        title,
        uploader,
        duration: parseDuration(durationText),
        thumbnail,
      });
    }
    if (items.length >= max) break;
  }
  return items;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405, headers: CORS });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get('q') ?? '';
  const max = Math.min(20, Math.max(1, parseInt(url.searchParams.get('max') ?? '12', 10)));

  if (!query.trim()) {
    return new Response(JSON.stringify({ error: 'q required' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const items = await searchInnertube(query, max);
    return new Response(JSON.stringify({ items }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[search-youtube]', err);
    return new Response(
      JSON.stringify({ error: String((err as Error)?.message ?? err) }),
      {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      }
    );
  }
});
