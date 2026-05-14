/**
 * Store de búsqueda avanzada multi-tipo.
 *
 * Mantiene la query activa + los 3 conjuntos de resultados (videos,
 * channels=artistas, playlists). Se hidrata con `fetch(query)` que
 * pega a `api.ytSearchAll` (Edge Function `search-youtube?type=all`).
 *
 * Diseñado para la vista `SearchView`. El dropdown rápido de `TopBar`
 * sigue usando `api.ytSearch` (solo videos, optimizado con prewarm en
 * lan-server).
 */
import { create } from 'zustand';
import { api } from '../lib/api.js';

export const useSearchStore = create((set, get) => ({
  query: '',
  /** @type {Array<{id:string,title:string,uploader?:string,duration?:number|null,thumbnail?:string|null}>} */
  videos: [],
  /** @type {Array<{id:string,title:string,subscribers?:string,thumbnail?:string|null}>} */
  channels: [],
  /** @type {Array<{id:string,title:string,videoCount?:number|null,thumbnail?:string|null,author?:string|null}>} */
  playlists: [],
  loading: false,
  error: null,

  /**
   * Carga resultados multi-tipo. Reusa cache de sesión si la query coincide.
   * @param {string} q
   */
  async fetch(q) {
    const query = String(q ?? '').trim();
    if (!query) return;
    if (get().query === query && get().videos.length > 0) return;
    set({ query, loading: true, error: null });
    try {
      const payload = await api.ytSearchAll(query);
      set({
        videos: payload?.videos ?? [],
        channels: payload?.channels ?? [],
        playlists: payload?.playlists ?? [],
        loading: false,
      });
    } catch (err) {
      console.warn('[search] falló', err?.message);
      set({ loading: false, error: String(err?.message ?? err) });
    }
  },

  /** Carga más resultados de un tipo específico (paginación simple). */
  async fetchMore(type) {
    const { query } = get();
    if (!query) return;
    set({ loading: true });
    try {
      const r = await api.ytSearchByType(query, type, 20);
      const items = r?.items ?? [];
      if (type === 'videos') set({ videos: items });
      else if (type === 'channels') set({ channels: items });
      else if (type === 'playlists') set({ playlists: items });
      set({ loading: false });
    } catch (err) {
      console.warn('[search] fetchMore', type, err?.message);
      set({ loading: false });
    }
  },

  reset() {
    set({ query: '', videos: [], channels: [], playlists: [], loading: false, error: null });
  },
}));
