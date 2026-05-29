// Cliente compartido de YouTube Innertube API.
//
// Usado por recommendations (busqueda), yt-playlist-resolve (browse),
// y yt-recs (next con autoplay queue). Tres endpoints distintos pero
// mismo context client + parsers.
//
// Innertube no requiere OAuth ni API key del usuario; solo una API key
// publica de la app WEB que YouTube usa internamente. La key ha sido
// estable desde hace anos.

export const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
export const INNERTUBE_BASE = 'https://www.youtube.com/youtubei/v1';

/** Context client WEB para Innertube. Estable. */
export const INNERTUBE_CONTEXT_WEB = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20240101.00.00',
    hl: 'en',
    gl: 'US',
  },
};

/** Texto de un nodo Innertube `{ runs: [...] }` o `{ simpleText: '' }`. */
export function nodeText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node?.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node?.runs)) {
    return node.runs.map((r: any) => r?.text ?? '').join('');
  }
  return '';
}

/** Best-effort: extrae el thumbnail mas grande de un nodo `thumbnail`. */
export function pickThumbnail(thumb: any): string | null {
  const list = thumb?.thumbnails ?? [];
  if (!Array.isArray(list) || list.length === 0) return null;
  const sorted = list.slice().sort((a: any, b: any) => (b?.width ?? 0) - (a?.width ?? 0));
  return sorted[0]?.url ?? null;
}

/** Convierte "3:42" o "1:02:33" a segundos. */
export function parseDurationText(text: string | undefined | null): number | null {
  if (!text) return null;
  const parts = String(text).split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

/**
 * Llama al endpoint `next` de Innertube con un videoId. Devuelve la
 * "watch next" queue: videos relacionados que YouTube reproduciria
 * tras el actual via autoplay. Es la fuente mas rica de recomendaciones
 * fuera de la cuenta logueada del usuario.
 *
 * @returns Array de tracks reproducibles con metadata.
 */
export async function ytNext(videoId: string): Promise<Array<{
  ytId: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
  duration: number | null;
}>> {
  const body = {
    context: INNERTUBE_CONTEXT_WEB,
    videoId,
  };

  const r = await fetch(`${INNERTUBE_BASE}/next?key=${INNERTUBE_KEY}&prettyPrint=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`innertube next ${r.status}`);
  }
  const data = await r.json();

  // Path: contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results
  // Items son compactVideoRenderer.
  const out: Array<{
    ytId: string;
    title: string;
    artist: string | null;
    thumbnail: string | null;
    duration: number | null;
  }> = [];

  const results = data?.contents?.twoColumnWatchNextResults
    ?.secondaryResults?.secondaryResults?.results ?? [];

  for (const item of results) {
    const v = item?.compactVideoRenderer;
    if (!v?.videoId) continue;
    const title = nodeText(v?.title);
    if (!title) continue;
    // Filtrar el video de seed: no tiene sentido recomendar el mismo.
    if (v.videoId === videoId) continue;
    const artist = nodeText(v?.shortBylineText) || nodeText(v?.longBylineText) || null;
    const thumbnail = pickThumbnail(v?.thumbnail);
    const lengthText = nodeText(v?.lengthText);
    const duration = parseDurationText(lengthText);

    out.push({
      ytId: v.videoId,
      title,
      artist,
      thumbnail,
      duration,
    });
  }

  return out;
}

/**
 * Llama al endpoint de music.youtube.com para tracks de YouTube Music.
 * Resultados mas musicales (sin random videos), pero requiere un client
 * distinto: WEB_REMIX.
 *
 * Reservado para futuros usos. Por ahora ytNext con WEB cubre el caso.
 */
export const INNERTUBE_CONTEXT_MUSIC = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240101.00.00',
    hl: 'en',
    gl: 'US',
  },
};
