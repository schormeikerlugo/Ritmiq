// Edge Function: búsqueda en YouTube vía youtubei.js (Innertube API).
// No requiere YOUTUBE_API_KEY. Mismo extractor que resolve-stream.
//
// Endpoint:
//   GET /search-youtube?q=<query>&max=12
//   Response: { items: [{id,title,uploader,duration,thumbnail}, ...] }
//
// Forma compatible con la respuesta del LAN server `/yt/search` para que la
// PWA pueda usarla como fallback transparente.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { Innertube } from 'npm:youtubei.js@10';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

let yt: Innertube | null = null;
async function getYt() {
  if (!yt) yt = await Innertube.create({ retrieve_player: false });
  return yt;
}

interface Item {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
}

function pickThumbnail(thumbs: Array<{ url?: string }> | undefined): string | null {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
  // Última suele ser la de mayor calidad.
  return thumbs[thumbs.length - 1]?.url ?? null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get('q') ?? '';
  const max = Math.min(20, Math.max(1, parseInt(url.searchParams.get('max') ?? '12', 10)));

  if (!query.trim()) {
    return new Response(JSON.stringify({ error: 'q required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const innertube = await getYt();
    const search = await innertube.search(query, { type: 'video' });

    const items: Item[] = [];
    const videos = search.results ?? [];
    for (const v of videos) {
      if (items.length >= max) break;
      // youtubei.js representa videos con shape variable según tipo.
      // @ts-expect-error – varios tipos posibles
      const id: string | undefined = v.id ?? v.video_id;
      // @ts-expect-error – title puede ser objeto Text o string
      const titleRaw = v.title;
      const title: string =
        typeof titleRaw === 'string' ? titleRaw :
        titleRaw?.text ?? titleRaw?.toString?.() ?? '';
      // @ts-expect-error – varios shapes para uploader/canal
      const author = v.author ?? v.channel ?? {};
      const uploader: string | null =
        typeof author === 'string' ? author :
        author?.name ?? null;
      // @ts-expect-error – duration puede venir en diferentes formas
      const duration: number | null =
        v.duration?.seconds ??
        // @ts-expect-error
        (typeof v.length_seconds === 'number' ? v.length_seconds : null);
      // @ts-expect-error
      const thumbnail = pickThumbnail(v.thumbnails ?? v.best_thumbnail);

      if (!id || !title) continue;
      items.push({ id, title, uploader, duration, thumbnail });
    }

    return new Response(JSON.stringify({ items }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[search-youtube]', err);
    return new Response(
      JSON.stringify({ error: String((err as Error)?.message ?? err) }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }
});
