/**
 * Store de letras (lyrics) por track.
 *
 * Llama a la edge function `lyrics` (lrclib.net + cache 30d server-side).
 * Cache cliente en memoria por sesion en `entries[key]` donde key es
 * `${artist}::${title}::${durationBucket}`.
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
import { supabase } from '../lib/supabase.js';
import { withRetry } from '../lib/with-retry.js';

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
    const key = buildKey({ artist, title, duration });

    const cur = get().entries[key];
    if (cur && (cur.loading || cur.found !== undefined || cur.error)) {
      return cur;
    }

    set((s) => ({ entries: { ...s.entries, [key]: { loading: true } } }));
    try {
      const payload = await callLyrics({ artist, title, duration });
      const parsed = payload?.synced ? parseLrc(payload.synced) : [];
      const entry = {
        loading: false,
        found: !!payload?.found,
        synced: payload?.synced ?? null,
        plain: payload?.plain ?? null,
        instrumental: !!payload?.instrumental,
        parsed,
      };
      set((s) => ({ entries: { ...s.entries, [key]: entry } }));
      return entry;
    } catch (err) {
      console.warn('[lyrics] fetch failed', artist, title, err?.message);
      const entry = { loading: false, error: String(err?.message ?? err) };
      set((s) => ({ entries: { ...s.entries, [key]: entry } }));
      return entry;
    }
  },

  /** Devuelve la entry actual para un track (no dispara fetch). */
  get(params) {
    const key = buildKey({
      artist: params?.artist,
      title: params?.title,
      duration: params?.duration,
    });
    return get().entries[key];
  },

  reset() { set({ entries: {} }); },
}));
