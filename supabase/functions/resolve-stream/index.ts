// Edge Function: resuelve URL de stream de audio de YouTube vía Innertube.
//
// Truco clave: usamos el cliente ANDROID en lugar de WEB. YouTube entrega
// URLs sin signature cipher al cliente móvil, así no necesitamos descifrar
// nada (que requiere librerías pesadas que no funcionan bien en Deno Edge).
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

// Clientes que YouTube acepta y que SUELEN entregar URLs sin signatureCipher.
// Los probamos en orden hasta que uno funcione.
const CLIENTS = [
  {
    name: 'IOS',
    body: {
      context: {
        client: {
          clientName: 'IOS',
          clientVersion: '19.45.4',
          deviceMake: 'Apple',
          deviceModel: 'iPhone16,2',
          osName: 'iPhone',
          osVersion: '18.1.0.22B83',
          hl: 'en', gl: 'US',
        },
      },
    },
    userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
    apiKey: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
  },
  {
    name: 'ANDROID',
    body: {
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '19.44.38',
          androidSdkVersion: 34,
          osName: 'Android',
          osVersion: '14',
          hl: 'en', gl: 'US',
        },
      },
    },
    userAgent: 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip',
    apiKey: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
  },
  {
    name: 'WEB',
    body: {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240115.05.00',
          hl: 'en', gl: 'US',
        },
      },
    },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
  },
];

interface PickedFormat {
  url: string;
  contentType: string;
}

async function tryClient(ytId: string, c: typeof CLIENTS[number]): Promise<PickedFormat | null> {
  const body = {
    ...c.body,
    videoId: ytId,
    contentCheckOk: true,
    racyCheckOk: true,
  };

  const res = await fetch(`${INNERTUBE_URL}&key=${c.apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': c.userAgent,
      'X-YouTube-Client-Name': c.name === 'IOS' ? '5' : c.name === 'ANDROID' ? '3' : '1',
      'X-YouTube-Client-Version': c.body.context.client.clientVersion,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data?.playabilityStatus?.status === 'ERROR') return null;

  const formats: any[] =
    data?.streamingData?.adaptiveFormats ?? data?.streamingData?.formats ?? [];

  // Audio mp4/AAC con URL directa (sin signatureCipher).
  const audioMp4 = formats.filter((f) =>
    typeof f.mimeType === 'string' &&
    f.mimeType.startsWith('audio/mp4') &&
    typeof f.url === 'string'
  );
  if (audioMp4.length === 0) return null;

  audioMp4.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  const best = audioMp4[0];
  return {
    url: best.url,
    contentType: best.mimeType?.split(';')?.[0] ?? 'audio/mp4',
  };
}

async function resolveAudioFormat(ytId: string): Promise<PickedFormat> {
  for (const c of CLIENTS) {
    try {
      const result = await tryClient(ytId, c);
      if (result) {
        console.log(`[resolve-stream] ${ytId} resuelto vía cliente ${c.name}`);
        return result;
      }
    } catch (err) {
      console.warn(`[resolve-stream] ${c.name} fallo:`, err);
    }
  }
  throw new Error(
    'No se pudo obtener URL de audio sin cifrar. ' +
    'Usa LAN (Tailscale) o pre-descarga en casa.'
  );
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

    // Modo proxy: el Edge Function consume desde su IP y reenvía al cliente.
    const upstreamHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };
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
