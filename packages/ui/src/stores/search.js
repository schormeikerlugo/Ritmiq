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
  /** @type {Array<{ytId:string,title:string,artist:string,album?:string|null,coverUrl?:string|null,durationSeconds?:number|null,contributionCount:number}>}
   *  Tracks que la red Ritmiq ya canonizo. Provienen de tracks_global
   *  via search-youtube paso 0. Se renderizan en la franja superior
   *  con badge "Conocida en Ritmiq". */
  known: [],
  loading: false,
  error: null,

  // ── Estado de UI persistente (sobrevive a navegar fuera y volver) ────
  // Antes vivían como useState local en SearchView y se perdían al
  // remontar. Al subirlos al store, la búsqueda queda intacta hasta que
  // el usuario la limpia con el botón (reset()).
  /** @type {'all'|'videos'|'channels'|'playlists'} */
  activeTab: 'all',
  /** Posición de scroll del contenedor principal en la vista de búsqueda. */
  scrollTop: 0,

  setActiveTab(tab) { set({ activeTab: tab }); },
  setScrollTop(y) { set({ scrollTop: y }); },

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
        known: payload?.known ?? [],
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
    set({
      query: '', videos: [], channels: [], playlists: [], known: [],
      loading: false, error: null, activeTab: 'all', scrollTop: 0,
    });
  },
}));
