/**
 * Store de letras (lyrics) por track. Prioridad: SIEMPRE letra con tiempos
 * que cuadren con el audio que suena.
 *
 *   1. `track_lyrics` (Supabase, por yt_id): letra sincronizada con ESE vídeo
 *      por el servidor (subtítulos de YouTube, desfase o alineación Whisper).
 *   2. Función `lyrics` (LRCLIB, búsqueda amplia). Se usa sincronizada si su
 *      duración cuadra (±3 s) con la del vídeo.
 *   3. Si no cuadra o solo hay texto: se pide al servidor (`/lyrics/sync`) y
 *      se vuelve a mirar `track_lyrics` a los 8, 20, 45, 90 y 150 s. Mientras,
 *      texto sin tiempos (la TV lo desplaza según el avance). Si el servidor no
 *      lo consigue y la versión de LRCLIB difiere ≤ 15 s, se usa tal cual.
 *
 * Título y artista limpios (de las portadas, stores/art.js) si existen.
 * Cache en memoria por sesión en `entries[key]` (key = `yt:<id>` o
 * `${artist}::${title}::${durationBucket}`).
 *
 * Estados:
 *   undefined         \u2014 no se ha intentado todavia.
 *   { loading:true }  \u2014 fetch en vuelo.
 *   { error:'...' }   \u2014 fallo de red.
 *   { found:false }   \u2014 lrclib no tiene la letra.
 *   { found:true, synced:'...', plain:'...', instrumental: bool, parsed: [...] }
 *     donde `parsed` es array { timeMs, text } si synced existe.
 */
import { create } from 'zustand';
import { useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { withRetry } from '../lib/with-retry.js';
import { lyricsSyncRequest } from '../lib/lan-client.js';
import { useArtStore } from './art.js';

const MATCH_S = 3;          // LRCLIB vale tal cual si su duración difiere ≤ 3 s
const LOOSE_S = 15;         // si el servidor no puede, se acepta ≤ 15 s
const RECHECK_MS = [8000, 12000, 25000, 45000, 60000];

async function trackLyricsRow(ytId) {
  if (!ytId) return null;
  try {
    const { data } = await supabase.from('track_lyrics')
      .select('status, source, synced').eq('yt_id', ytId).maybeSingle();
    return data ?? null;
  } catch { return null; }
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callLyricsRaw({ artist, title, duration }) {
  if (!SUPABASE_URL) throw new Error('Supabase URL no configurado');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON;
  const url = new URL(`${SUPABASE_URL}/functions/v1/lyrics`);
  url.searchParams.set('artist', artist);
  url.searchParams.set('title', title);
  if (duration) url.searchParams.set('duration', String(Math.round(duration)));
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON ?? '',
    },
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const err = new Error(j.error ?? `lyrics ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

const callLyrics = (params) => withRetry(() => callLyricsRaw(params), {
  maxAttempts: 2,
  onRetry: (n, err) => console.info(`[lyrics] retry ${n}: ${err?.message}`),
});

/**
 * Parsea formato LRC sincronizado a [{ timeMs, text }].
 * Soporta lineas tipo:
 *   [00:12.34]Some line
 *   [00:12.34][00:45.10]Repeated chorus
 *   [00:12]Without ms
 * Filtra metadata [ti:...] [ar:...] que no son tiempos.
 */
function parseLrc(synced) {
  if (!synced) return [];
  const out = [];
  const lines = synced.split(/\r?\n/);
  // Tag de tiempo: [mm:ss.cs] o [mm:ss]
  const TIME_RE = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of lines) {
    let lastIdx = 0;
    const times = [];
    let m;
    TIME_RE.lastIndex = 0;
    while ((m = TIME_RE.exec(line)) !== null) {
      const mm = parseInt(m[1], 10);
      const ss = parseInt(m[2], 10);
      const cs = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const timeMs = (mm * 60 + ss) * 1000 + cs;
      if (Number.isFinite(timeMs)) times.push(timeMs);
      lastIdx = TIME_RE.lastIndex;
    }
    if (times.length === 0) continue;
    const text = line.slice(lastIdx).trim();
    // Filtramos metadata sin texto (ej: lineas tipo `[ti:Title]` ya
    // descartadas porque TIME_RE no las matchea, pero defensivo).
    if (!text && times.length === 1 && times[0] === 0) continue;
    for (const t of times) {
      out.push({ timeMs: t, text });
    }
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}

export function lyricsKey({ ytId, artist, title, duration }) {
  if (ytId) return `yt:${ytId}`;
  return buildKey({ artist, title, duration });
}

function buildKey({ artist, title, duration }) {
  const a = String(artist ?? '').trim().toLowerCase();
  const t = String(title ?? '').trim().toLowerCase();
  const bucket = duration ? Math.round(duration / 5) * 5 : 0;
  return `${a}::${t}::${bucket}`;
}

export const useLyricsStore = create((set, get) => ({
  /** @type {Record<string, any>} */
  entries: {},

  /**
   * Resuelve la letra de un track. Idempotente: si ya hay entrada
   * (loading o resuelta), devuelve la existente sin disparar nueva
   * llamada.
   * @param {{ artist:string, title:string, duration?:number|null }} params
   */
  async fetch(params) {
    const artist = String(params?.artist ?? '').trim();
    const title  = String(params?.title  ?? '').trim();
    if (!artist || !title) return null;
    const duration = Number.isFinite(params?.duration) ? params.duration : null;
    const ytId = params?.ytId ?? null;
    const key = lyricsKey({ ytId, artist, title, duration });

    const cur = get().entries[key];
    // No encontrada con otro título (p. ej. el de YouTube antes de limpiarlo):
    // reintentar con el nuevo.
    const retryNewTitle = cur && cur.found === false && !cur.loading && cur.q !== title;
    if (cur && !retryNewTitle && (cur.loading || cur.found !== undefined || cur.error)) {
      return cur;
    }
    const put = (entry) => set((s) => ({ entries: { ...s.entries, [key]: { ...entry, q: title } } }));
    put({ loading: true });

    const fromSynced = (synced, source, extra = {}) => ({
      loading: false, found: true, synced, plain: null, instrumental: false,
      parsed: parseLrc(synced), source, ...extra,
    });

    try {
      // 1. Sincronizada con este vídeo.
      const own = await trackLyricsRow(ytId);
      if (own?.status === 'found' && own.synced) {
        const e = fromSynced(own.synced, own.source ?? 'ritmiq');
        put(e);
        return e;
      }

      // 2. LRCLIB.
      const payload = await callLyrics({ artist, title, duration });
      const diff = duration && payload?.duration ? Math.abs(payload.duration - duration) : 0;
      if (payload?.synced && diff <= MATCH_S) {
        const e = fromSynced(payload.synced, 'lrclib');
        put(e);
        return e;
      }

      // Sin tiempos fiables todavía: texto (la TV lo desplaza según avance).
      const plainText = payload?.plain ?? (payload?.synced ? payload.synced.replace(/\[[^\]]*\]/g, '').trim() : null);
      const base = {
        loading: false,
        found: !!payload?.found,
        synced: null,
        plain: plainText,
        instrumental: !!payload?.instrumental,
        parsed: [],
      };
      const loose = payload?.synced && diff <= LOOSE_S ? payload.synced : null;

      // Ya se intentó en el servidor y no hubo forma.
      if (!ytId || payload?.instrumental || own?.status === 'none') {
        const e = loose ? fromSynced(loose, 'lrclib') : base;
        put(e);
        return e;
      }

      // 3. Pedir al servidor una versión sincronizada con este audio.
      put({ ...base, syncing: true });
      lyricsSyncRequest({
        ytId, title, artist, durationSeconds: duration,
        lrc: { synced: payload?.synced ?? null, plain: payload?.plain ?? null, duration: payload?.duration ?? null },
      }).catch(() => {});
      (async () => {
        for (const ms of RECHECK_MS) {
          await new Promise((r) => setTimeout(r, ms));
          const row = await trackLyricsRow(ytId);
          if (row?.status === 'found' && row.synced) { put(fromSynced(row.synced, row.source ?? 'ritmiq')); return; }
          if (row?.status === 'none') break;
        }
        put(loose ? fromSynced(loose, 'lrclib') : base);
      })();
      return get().entries[key];
    } catch (err) {
      console.warn('[lyrics] fetch failed', artist, title, err?.message);
      const entry = { loading: false, error: String(err?.message ?? err) };
      put(entry);
      return entry;
    }
  },

  /** Devuelve la entry actual para un track (no dispara fetch). */
  get(params) {
    return get().entries[lyricsKey(params ?? {})];
  },

  reset() { set({ entries: {} }); },
}));

/**
 * Hook: letra de una canción (dispara la búsqueda). Usa título/artista
 * limpios si las portadas ya identificaron la canción.
 * @param {object|null|undefined} track
 */
export function useTrackLyrics(track) {
  const art = useArtStore((s) => (track?.ytId ? s.entries[track.ytId] : null));
  const clean = art?.s === 'found' && art.t && art.ar;
  const params = {
    ytId: track?.ytId ?? null,
    artist: clean ? art.ar : (track?.artist ?? ''),
    title: clean ? art.t : (track?.title ?? ''),
    duration: track?.durationSeconds ?? null,
  };
  const key = lyricsKey(params);
  const entry = useLyricsStore((s) => s.entries[key]);
  const fetchLyrics = useLyricsStore((s) => s.fetch);
  useEffect(() => {
    if (params.artist && params.title) fetchLyrics(params).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, params.artist, params.title]);
  return { entry, key };
}
