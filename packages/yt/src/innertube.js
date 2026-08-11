/**
 * Resolución de URL de audio vía la API InnerTube de YouTube (sin yt-dlp).
 *
 * Técnica "estilo Demus": los clientes móviles IOS/ANDROID de InnerTube
 * entregan URLs de audio SIN `signatureCipher`, así que no hay que descifrar
 * nada ni invocar yt-dlp. Es mucho más rápido (~200-600ms) que la cascada de
 * yt-dlp (~1-3s), pero MÁS FRÁGIL: YouTube cambia sus apiKeys/clients y puede
 * exigir PO tokens. Por eso se usa como ACELERADOR OPORTUNISTA: si funciona,
 * ahorra 1-3s; si falla, el caller cae a yt-dlp (fuente robusta).
 *
 * Portado de supabase/functions/resolve-stream/index.ts (mismo enfoque ya
 * probado en producción como fallback cloud).
 *
 * @module @ritmiq/yt/innertube
 */

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

// Clientes que suelen entregar URLs sin signatureCipher. Se prueban en orden.
const CLIENTS = [
  {
    name: 'IOS',
    clientName: '5',
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
    clientName: '3',
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
];

/**
 * Intenta un cliente InnerTube. Devuelve la URL de audio m4a/AAC (sin
 * cipher) de mayor bitrate, o null.
 * @param {string} ytId
 * @param {typeof CLIENTS[number]} c
 * @param {number} timeoutMs
 * @returns {Promise<string|null>}
 */
async function tryClient(ytId, c, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${INNERTUBE_URL}&key=${c.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': c.userAgent,
        'X-YouTube-Client-Name': c.clientName,
        'X-YouTube-Client-Version': c.body.context.client.clientVersion,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify({
        ...c.body,
        videoId: ytId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.playabilityStatus?.status === 'ERROR') return null;

    const formats =
      data?.streamingData?.adaptiveFormats ?? data?.streamingData?.formats ?? [];
    // Audio mp4/AAC con URL directa (sin signatureCipher). iOS Safari solo
    // decodifica AAC/m4a, así que exigimos audio/mp4.
    const audioMp4 = formats.filter((f) =>
      typeof f.mimeType === 'string' &&
      f.mimeType.startsWith('audio/mp4') &&
      typeof f.url === 'string'
    );
    if (audioMp4.length === 0) return null;
    audioMp4.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    return audioMp4[0].url;
  } catch {
    return null; // timeout/red/parse → deja que el caller pruebe el siguiente
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resuelve la URL de audio m4a nativo vía InnerTube (IOS→ANDROID).
 * Devuelve null si ningún cliente entrega una URL sin cipher (el caller
 * debe caer a yt-dlp).
 *
 * @param {string} youtubeId  ID de 11 chars (no URL).
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string|null>}
 */
export async function resolveStreamUrlInnertube(youtubeId, opts = {}) {
  if (!youtubeId || typeof youtubeId !== 'string') return null;
  const timeoutMs = opts.timeoutMs ?? 2500;
  for (const c of CLIENTS) {
    const url = await tryClient(youtubeId, c, timeoutMs);
    if (url) return url;
  }
  return null;
}
