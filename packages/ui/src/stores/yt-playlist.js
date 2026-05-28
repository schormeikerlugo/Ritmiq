/**
 * Store de playlists publicas de YouTube.
 *
 * Mantiene un mapa `entries[playlistId]` con el payload de la edge function
 * `yt-playlist-resolve`. Cache en memoria por sesion \u2014 sin persistencia.
 * La edge function tampoco cachea server-side; si se vuelve hot path,
 * agregar tabla yt_playlist_cache similar a album_resolve_cache.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';
import { withRetry } from '../lib/with-retry.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callEdgeRaw(path, params) {
  if (!SUPABASE_URL) throw new Error('Supabase URL no configurado');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON;
  const url = new URL(`${SUPABASE_URL}/functions/v1/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON ?? '',
    },
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const err = new Error(j.error ?? `${path} ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// Envuelve callEdgeRaw con retry exponencial. Innertube + Last.fm tienen
// 5xx esporadicos que con 2 reintentos bastan para esconder al usuario.
function callEdge(path, params) {
  return withRetry(() => callEdgeRaw(path, params), {
    maxAttempts: 3,
    onRetry: (attempt, err, delay) => {
      console.info(`[yt-playlist] retry ${attempt} en ${delay}ms (${err?.message})`);
    },
  });
}

export const useYtPlaylistStore = create((set, get) => ({
  /** @type {Record<string, { loading?:boolean, error?:string|null, id?:string, title?:string, author?:string|null, coverUrl?:string|null, tracks?:any[] }>} */
  entries: {},

  /**
   * Resuelve una playlist por su YouTube playlistId. Devuelve la entrada
   * cacheada si ya estaba resuelta.
   * @param {string} id
   */
  async fetch(id) {
    const key = String(id ?? '').trim();
    if (!key) return null;
    const cur = get().entries[key];
    if (cur?.tracks?.length) return cur;
    if (cur?.loading) return cur;
    set((s) => ({ entries: { ...s.entries, [key]: { loading: true, error: null } } }));
    try {
      const payload = await callEdge('yt-playlist-resolve', { id: key });
      const entry = { ...payload, loading: false, error: null };
      set((s) => ({ entries: { ...s.entries, [key]: entry } }));
      return entry;
    } catch (err) {
      console.warn('[yt-playlist] fetch failed', key, err?.message);
      const entry = { loading: false, error: String(err?.message ?? err), tracks: [] };
      set((s) => ({ entries: { ...s.entries, [key]: entry } }));
      return entry;
    }
  },

  reset() { set({ entries: {} }); },
}));
