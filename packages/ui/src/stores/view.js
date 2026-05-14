import { create } from 'zustand';

/**
 * Estado de navegación de la vista central.
 * - 'home'      → pantalla de inicio (recomendaciones futuras)
 * - 'library'   → todas las canciones guardadas
 * - 'playlist'  → una playlist concreta (usar `playlistId`)
 */

/**
 * @typedef {
 *   | { kind: 'home' }
 *   | { kind: 'library' }
 *   | { kind: 'downloads' }
 *   | { kind: 'playlist', playlistId: string }
 *   | { kind: 'search', query: string }
 *   | { kind: 'artist', name: string }
 *   | { kind: 'album', artist: string, album: string }
 * } View
 */

// Stack máximo de historial — suficiente para navegación normal sin acumular
// memoria si el usuario navega mucho dentro de una sesión.
const HISTORY_MAX = 30;

function navigateTo(set, get, view) {
  const cur = get().view;
  // No empujar al stack si vamos a la misma vista exacta.
  const sameView = JSON.stringify(cur) === JSON.stringify(view);
  if (sameView) {
    set({ view, sidebarOpen: false });
    return;
  }
  const stack = [...get().history, cur].slice(-HISTORY_MAX);
  set({ view, history: stack, sidebarOpen: false });
}

export const useViewStore = create((set, get) => ({
  /** @type {View} */
  view: { kind: 'home' },
  /** @type {View[]} historial para back. */
  history: [],
  queueOpen: false,
  sidebarOpen: false, // móvil: overlay
  nowPlayingOpen: false, // mobile fullscreen player

  // Navegaciones "top-level" desde sidebar resetean el historial — el botón
  // "atrás" solo tiene sentido dentro de un flujo de navegación lateral
  // (search → artist → album).
  goHome:      () => set({ view: { kind: 'home' }, history: [], sidebarOpen: false }),
  goLibrary:   () => set({ view: { kind: 'library' }, history: [], sidebarOpen: false }),
  goDownloads: () => set({ view: { kind: 'downloads' }, history: [], sidebarOpen: false }),
  /** @param {string} playlistId */
  goPlaylist: (playlistId) =>
    set({ view: { kind: 'playlist', playlistId }, history: [], sidebarOpen: false }),

  // Navegaciones "exploratorias" sí guardan historial → permiten back.
  /** @param {string} query */
  goSearch: (query) => navigateTo(set, get, { kind: 'search', query }),
  /** @param {string} name */
  goArtist: (name) => navigateTo(set, get, { kind: 'artist', name }),
  /** @param {string} artist @param {string} album */
  goAlbum: (artist, album) => navigateTo(set, get, { kind: 'album', artist, album }),

  /** Retrocede al view anterior si lo hay, sino va a home. */
  goBack: () => {
    const stack = get().history;
    if (stack.length === 0) {
      set({ view: { kind: 'home' }, history: [], sidebarOpen: false });
      return;
    }
    const next = stack[stack.length - 1];
    set({ view: next, history: stack.slice(0, -1), sidebarOpen: false });
  },

  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  closeQueue:  () => set({ queueOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeSidebar:  () => set({ sidebarOpen: false }),
  openNowPlaying:  () => set({ nowPlayingOpen: true }),
  closeNowPlaying: () => set({ nowPlayingOpen: false }),
}));
