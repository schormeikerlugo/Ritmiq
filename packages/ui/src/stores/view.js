import { create } from 'zustand';

/**
 * Estado de navegación de la vista central.
 * - 'home'      → pantalla de inicio (recomendaciones futuras)
 * - 'library'   → todas las canciones guardadas
 * - 'playlist'  → una playlist concreta (usar `playlistId`)
 */

/** @typedef {{ kind: 'home' } | { kind: 'library' } | { kind: 'downloads' } | { kind: 'playlist', playlistId: string }} View */

export const useViewStore = create((set) => ({
  /** @type {View} */
  view: { kind: 'home' },
  queueOpen: false,
  sidebarOpen: false, // móvil: overlay

  goHome:      () => set({ view: { kind: 'home' }, sidebarOpen: false }),
  goLibrary:   () => set({ view: { kind: 'library' }, sidebarOpen: false }),
  goDownloads: () => set({ view: { kind: 'downloads' }, sidebarOpen: false }),
  /** @param {string} playlistId */
  goPlaylist: (playlistId) =>
    set({ view: { kind: 'playlist', playlistId }, sidebarOpen: false }),

  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  closeQueue:  () => set({ queueOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeSidebar:  () => set({ sidebarOpen: false }),
}));
