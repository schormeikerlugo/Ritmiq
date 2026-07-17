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
  /** Token de continuación para "Ver más" videos (null = no hay más). */
  videosContinuation: null,
  /** True mientras se cargan más videos (botón Ver más). */
  loadingMore: false,
  /** Marca si el tab dedicado ya cargó su versión ampliada (max=30). */
  expandedTabs: /** @type {Set<string>} */ (new Set()),

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
    // Nueva búsqueda: resetea el estado de paginación.
    set({ query, loading: true, error: null, videosContinuation: null, expandedTabs: new Set() });
    try {
      const payload = await api.ytSearchAll(query);
      set({
        videos: payload?.videos ?? [],
        channels: payload?.channels ?? [],
        playlists: payload?.playlists ?? [],
        known: payload?.known ?? [],
        videosContinuation: payload?.videosContinuation ?? null,
        loading: false,
      });
    } catch (err) {
      console.warn('[search] falló', err?.message);
      set({ loading: false, error: String(err?.message ?? err) });
    }
  },

  /**
   * Al abrir un tab dedicado, carga una versión AMPLIADA (max=30) de ese tipo
   * (reemplaza los ~12 del fetchAll). Idempotente por tab: solo la primera vez.
   * @param {'videos'|'channels'|'playlists'} type
   */
  async fetchMore(type) {
    const { query, expandedTabs } = get();
    if (!query || expandedTabs.has(type)) return;
    set({ loadingMore: true });
    try {
      const r = await api.ytSearchByType(query, type, 30);
      const items = r?.items ?? [];
      const next = new Set(expandedTabs); next.add(type);
      if (type === 'videos') {
        set({ videos: items, videosContinuation: r?.continuation ?? null, expandedTabs: next });
      } else if (type === 'channels') {
        set({ channels: items, expandedTabs: next });
      } else if (type === 'playlists') {
        set({ playlists: items, expandedTabs: next });
      }
      set({ loadingMore: false });
    } catch (err) {
      console.warn('[search] fetchMore', type, err?.message);
      set({ loadingMore: false });
    }
  },

  /** Botón "Ver más": añade la siguiente página de videos (append). */
  async loadMoreVideos() {
    const { query, videosContinuation, videos, loadingMore } = get();
    if (!query || !videosContinuation || loadingMore) return;
    set({ loadingMore: true });
    try {
      const r = await api.ytSearchByType(query, 'videos', 30, videosContinuation);
      const more = r?.items ?? [];
      // Dedupe por id para no repetir videos entre páginas.
      const seen = new Set(videos.map((v) => v.id));
      const fresh = more.filter((v) => v?.id && !seen.has(v.id));
      set({
        videos: [...videos, ...fresh],
        videosContinuation: r?.continuation ?? null,
        loadingMore: false,
      });
    } catch (err) {
      console.warn('[search] loadMoreVideos', err?.message);
      set({ loadingMore: false });
    }
  },

  reset() {
    set({
      query: '', videos: [], channels: [], playlists: [], known: [],
      loading: false, error: null, activeTab: 'all', scrollTop: 0,
      videosContinuation: null, loadingMore: false, expandedTabs: new Set(),
    });
  },
}));
