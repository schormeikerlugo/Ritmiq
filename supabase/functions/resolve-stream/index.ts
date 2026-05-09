import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { Innertube } from 'npm:youtubei.js@10';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers':
    'Content-Range, Accept-Ranges, Content-Length, Content-Type',
};

let yt: Innertube | null = null;
async function getYt() {
  if (!yt) yt = await Innertube.create({ retrieve_player: true });
  return yt;
}

async function resolveStreamUrl(ytId: string) {
  const innertube = await getYt();
  const info = await innertube.getInfo(ytId);
  const format = info.chooseFormat({
    type: 'audio',
    quality: 'best',
    format: 'mp4',
  });
  if (!format) throw new Error('No audio format available');
  const url = format.decipher(innertube.session.player);
  return { url, contentType: format.mime_type ?? 'audio/mp4' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const ytId = url.searchParams.get('ytId');
  const proxy = url.searchParams.get('proxy') === '1';

  if (!ytId) {
    return new Response(JSON.stringify({ error: 'ytId required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { url: streamUrl, contentType } = await resolveStreamUrl(ytId);

    if (!proxy) {
      return new Response(JSON.stringify({ url: streamUrl, contentType }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const upstreamHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };
    const range = req.headers.get('range');
    if (range) upstreamHeaders['Range'] = range;

    const upstream = await fetch(streamUrl, { headers: upstreamHeaders });

    const headers = new Headers(CORS_HEADERS);
    const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!upstream.headers.get('content-type')) headers.set('Content-Type', contentType);
    if (!upstream.headers.get('accept-ranges')) headers.set('Accept-Ranges', 'bytes');

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    console.error('[resolve-stream]', err);
    return new Response(
      JSON.stringify({ error: String((err as Error)?.message ?? err) }),
      { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
