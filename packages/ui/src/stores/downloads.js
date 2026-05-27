import { create } from 'zustand';
import { api, isDesktop } from '../lib/api.js';
import { useLibraryStore } from './library.js';
import { toast } from './toast.js';

const CONCURRENCY = 2;

/**
 * @typedef {Object} DLEntry
 * @property {string} trackId
 * @property {string} title
 * @property {'queued'|'running'|'done'|'error'} status
 * @property {number} progress      0..100
 * @property {string} [error]
 */

let installedListener = false;

function ensureProgressListener(set, get) {
  if (installedListener) return;
  installedListener = true;
  api.libraryOnDownloadProgress(({ trackId, pct }) => {
    set((s) => ({
      entries: s.entries.map((e) =>
        e.trackId === trackId && e.status === 'running'
          ? { ...e, progress: pct }
          : e
      ),
    }));
  });
}

export const useDownloadsStore = create((set, get) => ({
  /** @type {DLEntry[]} */
  entries: [],
  visible: false,

  /**
   * Encola una lista de tracks para descargar (desktop a disco, PWA a IndexedDB).
   * @param {Array<{id: string, title: string, isDownloaded?: boolean}>} tracks
   */
  enqueue(tracks) {
    ensureProgressListener(set, get);
    const existing = new Set(get().entries.map((e) => e.trackId));
    const fresh = tracks
      .filter((t) => !t.isDownloaded && !existing.has(t.id))
      .map((t) => /** @type {DLEntry} */ ({
        trackId: t.id,
        title: t.title,
        status: 'queued',
        progress: 0,
      }));
    if (fresh.length === 0) return;
    set((s) => ({ entries: [...s.entries, ...fresh], visible: true }));
    pump(set, get);
  },

  hide() { set({ visible: false }); },

  /** Limpia entries terminados (done/error). */
  clearFinished() {
    set((s) => ({
      entries: s.entries.filter((e) => e.status === 'queued' || e.status === 'running'),
    }));
  },
}));

async function pump(set, get) {
  const running = get().entries.filter((e) => e.status === 'running').length;
  const slots = CONCURRENCY - running;
  if (slots <= 0) return;

  const queued = get().entries.filter((e) => e.status === 'queued').slice(0, slots);
  for (const entry of queued) {
    // Marcar como running antes de iniciar
    set((s) => ({
      entries: s.entries.map((e) =>
        e.trackId === entry.trackId ? { ...e, status: 'running' } : e
      ),
    }));
    runOne(entry.trackId, set, get);
  }
}

async function runOne(trackId, set, get) {
  let entryTitle = trackId;
  try {
    // En desktop pasamos la fila completa como fallback. El IPC la inserta
    // en SQLite si no estaba (tracks importados de Spotify pueden estar en
    // Supabase pero no replicados aún a SQLite).
    let payload = trackId;
    if (isDesktop) {
      const t = useLibraryStore.getState().tracks.find((x) => x.id === trackId);
      if (t) { payload = { trackId, fallback: t }; entryTitle = t.title; }
    } else {
      const e = get().entries.find((x) => x.trackId === trackId);
      if (e) entryTitle = e.title;
    }
    await api.libraryDownload(payload);
    set((s) => ({
      entries: s.entries.map((e) =>
        e.trackId === trackId ? { ...e, status: 'done', progress: 100 } : e
      ),
    }));
    // Refrescar la biblioteca para que aparezca como descargada
    try { await useLibraryStore.getState().load(); } catch {}
    toast.success(`"${entryTitle}" descargada`, { icon: 'ArrowDownToLine' });
  } catch (err) {
    set((s) => ({
      entries: s.entries.map((e) =>
        e.trackId === trackId ? { ...e, status: 'error', error: String(err?.message ?? err) } : e
      ),
    }));
    toast.error(`Error al descargar "${entryTitle}": ${String(err?.message ?? err)}`);
  } finally {
    pump(set, get);
  }
}
