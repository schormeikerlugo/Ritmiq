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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { cleanYoutubeTitle, cleanUploader } from '../_shared/clean-track-meta.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

// Cliente Supabase con service_role para leer tracks_global sin
// depender del JWT del caller (la tabla es publica para auth, pero
// usar service evita un round-trip de validacion del token aqui).
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

interface KnownItem {
  ytId: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  durationSeconds: number | null;
  contributionCount: number;
}

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
  // YouTube marca como "Official Artist Channel" a los canales verificados
  // por la propia artista/banda. Es la unica senal confiable (entre N
  // canales con el mismo nombre, tributos, fans, etc) para identificar
  // cual es el real. Innertube lo expone como ownerBadges con
  // style === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST'.
  verified: boolean;
  // Canales auto-generados por YouTube Music ("<Artist> - Topic").
  // No son el canal oficial humano pero contienen el catalogo musical
  // licenciado del sello. Marcarlo permite al cliente diferenciarlos
  // visualmente sin descartarlos.
  isTopic: boolean;
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

async function callInnertube(
  query: string,
  params: string | null,
  continuation: string | null = null,
): Promise<any> {
  const body: any = {
    context: {
      client: { clientName: 'WEB', clientVersion: '2.20240115.05.00', hl: 'en', gl: 'US' },
    },
  };
  // Paginación: si viene un continuation token, YouTube ignora query/params
  // y devuelve la siguiente página de resultados.
  if (continuation) {
    body.continuation = continuation;
  } else {
    body.query = query;
    if (params) body.params = params;
  }
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

/** Itera secciones de search.contents.* y extrae renderers de cada tipo.
 *  Soporta tanto la primera página (twoColumnSearchResultsRenderer) como las
 *  páginas de continuación (onResponseReceivedCommands). Devuelve además el
 *  `continuation` token para pedir la siguiente página. */
function extractItems(data: any) {
  const videos: VideoItem[] = [];
  const channels: ChannelItem[] = [];
  const playlists: PlaylistItem[] = [];
  let continuation: string | null = null;

  // Primera página: sectionListRenderer.contents. Continuación:
  // onResponseReceivedCommands[].appendContinuationItemsAction.continuationItems.
  const firstPage =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents ?? null;
  const contItems =
    data?.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction
      ?.continuationItems ?? null;
  const sections = firstPage ?? contItems ?? [];

  for (const section of sections) {
    // En continuación, los items pueden venir directos (sin itemSectionRenderer)
    // o dentro de itemSectionRenderer. También aparece un continuationItemRenderer.
    if (section?.continuationItemRenderer) {
      continuation =
        section.continuationItemRenderer?.continuationEndpoint
          ?.continuationCommand?.token ?? continuation;
      continue;
    }
    const contents = section?.itemSectionRenderer?.contents ??
      (section?.videoRenderer || section?.channelRenderer || section?.playlistRenderer
        ? [section]
        : []);
    for (const it of contents) {
      if (it?.videoRenderer) {
        const v = it.videoRenderer;
        if (!v.videoId) continue;
        const rawTitle = v.title?.runs?.[0]?.text ?? v.title?.simpleText ?? '';
        const rawUploader =
            v.ownerText?.runs?.[0]?.text ??
            v.longBylineText?.runs?.[0]?.text ??
            null;
        // Limpieza canonica en la RAIZ: ningun cliente recibe nunca
        // mas un title como "Waiting For The End (Official Music Video)
        // [4K Upgrade]". Si la heuristica detecta un canal generico
        // (VEVO, Records, etc) tambien separa "Artist - Title" en sus
        // campos correctos. Ver supabase/functions/_shared/clean-track-meta.ts.
        const cleaned = cleanYoutubeTitle({ rawTitle, rawUploader });
        videos.push({
          id: v.videoId,
          title: cleaned.title || rawTitle,    // fallback si cleanup dejo vacio
          uploader: cleaned.artist ?? cleanUploader(rawUploader) ?? rawUploader,
          duration: parseDuration(
            v.lengthText?.simpleText ?? v.lengthText?.runs?.[0]?.text ?? null
          ),
          thumbnail: pickThumb(v.thumbnail?.thumbnails),
        });
      } else if (it?.channelRenderer) {
        const c = it.channelRenderer;
        if (!c.channelId) continue;
        const title: string = c.title?.simpleText ?? c.title?.runs?.[0]?.text ?? '';
        // ownerBadges: el badge BADGE_STYLE_TYPE_VERIFIED_ARTIST significa
        // "Official Artist Channel" segun YouTube. Es la unica senal
        // 100% confiable de oficialidad. Devolvemos boolean al cliente
        // y lo mostramos como checkmark sobre el avatar circular.
        const badges: any[] = Array.isArray(c.ownerBadges) ? c.ownerBadges : [];
        const verified = badges.some((b) =>
          b?.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST'
        );
        // Canal "- Topic" auto-generado por YT Music: catalogo licenciado
        // del sello, no canal oficial humano. Se distinguen por sufijo
        // " - Topic" en el titulo.
        const isTopic = /\s-\sTopic$/i.test(title);
        channels.push({
          id: c.channelId,
          title,
          subscribers:
            c.videoCountText?.simpleText ??
            c.subscriberCountText?.simpleText ??
            null,
          thumbnail: pickThumb(c.thumbnail?.thumbnails),
          verified,
          isTopic,
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
  return { videos, channels, playlists, continuation };
}

async function searchOneType(
  query: string,
  type: keyof typeof TYPE_PARAMS,
  max: number,
  continuation: string | null = null,
) {
  const data = await callInnertube(query, TYPE_PARAMS[type], continuation);
  const extracted = extractItems(data);
  const items =
    type === 'videos' ? extracted.videos
    : type === 'channels' ? extracted.channels
    : extracted.playlists;
  return { items: items.slice(0, max), continuation: extracted.continuation };
}

async function searchAll(query: string, perType: number) {
  // 3 búsquedas paralelas, una por tipo. Guardamos el continuation de videos
  // para permitir "Ver más" en el tab de canciones sin re-buscar.
  const [videosRes, channelsRes, playlistsRes] = await Promise.allSettled([
    callInnertube(query, TYPE_PARAMS.videos).then((d) => extractItems(d)),
    callInnertube(query, TYPE_PARAMS.channels).then((d) => extractItems(d).channels.slice(0, perType)),
    callInnertube(query, TYPE_PARAMS.playlists).then((d) => extractItems(d).playlists.slice(0, perType)),
  ]);
  const videosData = videosRes.status === 'fulfilled' ? videosRes.value : { videos: [], continuation: null };
  return {
    videos:   videosData.videos.slice(0, perType),
    channels: channelsRes.status === 'fulfilled' ? channelsRes.value : [],
    playlists: playlistsRes.status === 'fulfilled' ? playlistsRes.value : [],
    videosContinuation: videosData.continuation ?? null,
  };
}

/**
 * Lookup en tracks_global por query. Hace 2 estrategias en paralelo:
 *   1. FTS (Full Text Search) sobre titulo+artista para queries >= 3 chars.
 *   2. ILIKE prefijo+substring para queries cortas o cuando FTS no machea.
 *
 * Tolerante a errores: si la tabla aun no existe o la query falla, devuelve
 * array vacio para que el caller siga con Innertube sin regresion.
 *
 * Limite: 10 known items por query. Mas que eso satura la UI de tracks
 * conocidos antes de los resultados frescos de YouTube.
 */
async function searchKnown(query: string, limit = 10): Promise<KnownItem[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    // ILIKE patron: %palabra1%palabra2%... — match parcial por orden de palabras.
    const words = q.split(/\s+/).filter(Boolean);
    const ilikePattern = '%' + words.join('%') + '%';
    const { data, error } = await sb
      .from('tracks_global')
      .select('yt_id, title, artist, album, cover_url, duration_seconds, contribution_count')
      .or(`title.ilike.${ilikePattern},artist.ilike.${ilikePattern}`)
      .order('contribution_count', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[search-known] lookup error (non fatal):', error.message);
      return [];
    }
    return (data ?? []).map((r): KnownItem => ({
      ytId: r.yt_id,
      title: r.title,
      artist: r.artist,
      album: r.album ?? null,
      coverUrl: r.cover_url ?? null,
      durationSeconds: r.duration_seconds ?? null,
      contributionCount: r.contribution_count ?? 0,
    }));
  } catch (err) {
    console.warn('[search-known] exception (non fatal):', err);
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS });

  const url = new URL(req.url);
  const query = url.searchParams.get('q') ?? '';
  const type = (url.searchParams.get('type') ?? 'videos').toLowerCase();
  const max = Math.min(40, Math.max(1, parseInt(url.searchParams.get('max') ?? '12', 10)));
  // Paginación: token de continuación de InnerTube para "Ver más".
  const continuation = url.searchParams.get('continuation');
  // Flag opcional para deshabilitar known lookup (debugging / A/B testing).
  const includeKnown = url.searchParams.get('known') !== '0';

  // Petición de paginación: solo tiene sentido para un tipo concreto.
  if (continuation && type in TYPE_PARAMS) {
    try {
      const oneRes = await searchOneType(query, type as keyof typeof TYPE_PARAMS, max, continuation);
      return new Response(JSON.stringify({ ...oneRes, known: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('[search-youtube] continuation', err);
      return new Response(JSON.stringify({ items: [], continuation: null }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }

  if (!query.trim()) {
    return new Response(JSON.stringify({ error: 'q required' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Lanzamos known y innertube EN PARALELO para minimizar latencia
    // total. Si la tabla esta vacia, known retorna [] casi instante.
    const knownP = (includeKnown && (type === 'videos' || type === 'all'))
      ? searchKnown(query)
      : Promise.resolve([] as KnownItem[]);

    let payload: any;
    if (type === 'all') {
      // 12 por tipo (antes 5): InnerTube ya los devuelve, sin coste extra.
      // La UI muestra 5 en el resumen "Todo" y el resto en el tab dedicado.
      const [allRes, known] = await Promise.all([searchAll(query, 12), knownP]);
      payload = { ...allRes, known };
    } else if (type in TYPE_PARAMS) {
      const [oneRes, known] = await Promise.all([
        searchOneType(query, type as keyof typeof TYPE_PARAMS, max),
        knownP,
      ]);
      payload = { ...oneRes, known };
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
