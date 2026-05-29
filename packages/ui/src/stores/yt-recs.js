/**
 * Store de YouTube Music recomendaciones (Fase 6.1).
 *
 * Llama a la edge function `yt-recs` con un seedYtId; devuelve videos
 * relacionados de la "watch next" queue de Innertube. Cache cliente en
 * memoria por sesion + cache server-side 6h en recommendation_cache.
 *
 * Diferencia con [[recommendations]]:
 *   - Source: YouTube autoplay queue (no Last.fm).
 *   - Captura tracks recientes que Last.fm tarda en indexar.
 *   - Cubre mejor catalogo latino + asiatico.
 *   - "Artista" viene del shortBylineText (canal); puede ser ruido
 *     ("Bad Bunny - Topic") pero el ytId es siempre correcto.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';
import { withRetry } from '../lib/with-retry.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callYtRecsRaw(seedYtId) {
  if (!SUPABASE_URL) throw new Error('Supabase URL no configurado');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON;
  const url = new URL(`${SUPABASE_URL}/functions/v1/yt-recs`);
  url.searchParams.set('seed', seedYtId);
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON ?? '',
    },
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const err = new Error(j.error ?? `yt-recs ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

const callYtRecs = (seedYtId) => withRetry(() => callYtRecsRaw(seedYtId), {
  maxAttempts: 2,
  onRetry: (n, err) => console.info(`[yt-recs] retry ${n}: ${err?.message}`),
});

/** Convierte un track del payload yt-recs en Track-like reproducible. */
function ytTrackToTrack(t) {
  return {
    id: `yt:${t.ytId}`,
    userId: '',
    source: 'youtube',
    ytId: t.ytId,
    title: t.title,
    artist: t.artist ?? null,
    album: null,
    durationSeconds: t.duration ?? null,
    coverUrl: t.thumbnail ?? null,
    filePath: null,
    isDownloaded: false,
    createdAt: new Date().toISOString(),
    reason: 'YouTube relacionado',
  };
}

export const useYtRecsStore = create((set, get) => ({
  /** @type {Record<string, { loading?:boolean, error?:string|null, tracks?:any[] }>} */
  entries: {},

  /**
   * Resuelve recomendaciones para un seedYtId. Idempotente.
   * @param {string} seedYtId YouTube videoId del seed (el track actual)
   */
  async fetch(seedYtId) {
    const key = String(seedYtId ?? '').trim();
    if (!key) return null;
    const cur = get().entries[key];
    if (cur?.tracks?.length) return cur;
    if (cur?.loading) return cur;
    set((s) => ({ entries: { ...s.entries, [key]: { loading: true } } }));
    try {
      const payload = await callYtRecs(key);
      const tracks = (payload?.tracks ?? []).map(ytTrackToTrack);
      const entry = { loading: false, error: null, tracks };
      set((s) => ({ entries: { ...s.entries, [key]: entry } }));
      return entry;
    } catch (err) {
      console.warn('[yt-recs] fetch failed', key, err?.message);
      const entry = { loading: false, error: String(err?.message ?? err), tracks: [] };
      set((s) => ({ entries: { ...s.entries, [key]: entry } }));
      return entry;
    }
  },

  reset() { set({ entries: {} }); },
}));
