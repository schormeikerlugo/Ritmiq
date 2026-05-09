// Edge Function: resuelve URL de stream de audio de YouTube vía Innertube.
//
// Estrategia minimalista: llama directamente al endpoint /youtubei/v1/player
// y devuelve la mejor URL de audio AAC/MP4 (compatible con iOS).
//
// LIMITACIÓN: muchos videos modernos llevan signature cipher; esos no podrán
// resolverse desde aquí (devuelven URL inválida). Para esos el usuario debe
// usar LAN (Tailscale) o pre-descargar la canción en casa.
//
// Endpoints:
//   GET /resolve-stream?ytId=<id>             → JSON con { url, contentType }
//   GET /resolve-stream?ytId=<id>&proxy=1     → Proxy de bytes con Range

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers':
    'Content-Range, Accept-Ranges, Content-Length, Content-Type',
};

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface PickedFormat {
  url: string;
  contentType: string;
}

/** Llama a Innertube /player y elige la mejor URL de audio mp4/AAC sin cifrar. */
async function resolveAudioFormat(ytId: string): Promise<PickedFormat> {
  // Usamos el cliente WEB. Algunas señales sugieren que ANDROID o IOS dan
  // URLs sin cifrar para más videos, pero también más rate-limited.
  const body = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240115.05.00',
        hl: 'en',
        gl: 'US',
      },
    },
    videoId: ytId,
    contentCheckOk: true,
    racyCheckOk: true,
  };

  const res = await fetch(`${INNERTUBE_URL}&key=${INNERTUBE_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Innertube ${res.status}`);
  const data = await res.json();

  if (data?.playabilityStatus?.status === 'ERROR') {
    throw new Error(data.playabilityStatus.reason ?? 'Video no disponible');
  }

  const formats: any[] =
    data?.streamingData?.adaptiveFormats ?? data?.streamingData?.formats ?? [];

  // Filtrar audio mp4/AAC (compatible iOS Safari).
  const audioMp4 = formats.filter((f) =>
    typeof f.mimeType === 'string' &&
    f.mimeType.startsWith('audio/mp4') &&
    f.url   // descartamos los que llevan signatureCipher (necesitan decipher)
  );

  if (audioMp4.length === 0) {
    throw new Error(
      'No hay URL de audio sin cifrar para este video. ' +
      'Conecta tu PC vía LAN/Tailscale o descarga la canción en casa.'
    );
  }

  // Mejor calidad disponible
  audioMp4.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  const best = audioMp4[0];

  return {
    url: best.url,
    contentType: best.mimeType?.split(';')?.[0] ?? 'audio/mp4',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405, headers: CORS });
  }

  const url = new URL(req.url);
  const ytId = url.searchParams.get('ytId');
  const proxy = url.searchParams.get('proxy') === '1';

  if (!ytId) {
    return new Response(JSON.stringify({ error: 'ytId required' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { url: streamUrl, contentType } = await resolveAudioFormat(ytId);

    if (!proxy) {
      return new Response(JSON.stringify({ url: streamUrl, contentType }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const upstreamHeaders: Record<string, string> = { 'User-Agent': UA };
    const range = req.headers.get('range');
    if (range) upstreamHeaders['Range'] = range;

    const upstream = await fetch(streamUrl, { headers: upstreamHeaders });

    const headers = new Headers(CORS);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
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
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
