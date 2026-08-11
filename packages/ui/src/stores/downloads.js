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
  /** Flag interno: ¿ya se notificó el fin de la tanda actual? */
  _notified: false,

  /**
   * Encola una lista de tracks para descargar (desktop a disco, PWA a IndexedDB).
   * @param {Array<{id: string, title: string, isDownloaded?: boolean}>} tracks
   */
  enqueue(tracks) {
    ensureProgressListener(set, get);
    // Si la tanda anterior ya terminó por completo, limpiar sus entries
    // (done/error) antes de encolar la nueva. Así el toast-resumen cuenta
    // solo la tanda actual y no arrastra descargas viejas ya notificadas.
    const cur = get().entries;
    const allFinished = cur.length > 0 &&
      cur.every((e) => e.status === 'done' || e.status === 'error');
    const base = allFinished ? [] : cur;
    const existing = new Set(base.map((e) => e.trackId));
    const fresh = tracks
      .filter((t) => !t.isDownloaded && !existing.has(t.id))
      .map((t) => /** @type {DLEntry} */ ({
        trackId: t.id,
        title: t.title,
        status: 'queued',
        progress: 0,
      }));
    if (fresh.length === 0) {
      // Nada nuevo que encolar; si además limpiamos la tanda vieja, ocultar.
      if (allFinished) set({ entries: [], visible: false, _notified: false });
      return;
    }
    set({ entries: [...base, ...fresh], visible: true, _notified: false });
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
  const queuedCount = get().entries.filter((e) => e.status === 'queued').length;

  // Tanda terminada: sin running ni queued y hay entries finalizados → toast
  // agregado una sola vez (flag _notified evita repetirlo en pumps sucesivos).
  if (running === 0 && queuedCount === 0) {
    if (get().entries.length > 0 && !get()._notified) {
      set({ _notified: true });
      notifyBatchComplete(get);
    }
    return;
  }
  // Hay trabajo pendiente/en curso → reset del flag para la próxima tanda.
  if (get()._notified) set({ _notified: false });

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
        e.trackId === trackId ? { ...e, status: 'done', progress: 100, title: entryTitle } : e
      ),
    }));
    // Refrescar la biblioteca para que aparezca como descargada
    try { await useLibraryStore.getState().load(); } catch {}
  } catch (err) {
    set((s) => ({
      entries: s.entries.map((e) =>
        e.trackId === trackId ? { ...e, status: 'error', error: String(err?.message ?? err), title: entryTitle } : e
      ),
    }));
  } finally {
    // NO emitimos un toast por track (spam al descargar varias). El toast
    // agregado se dispara UNA vez cuando la tanda termina, en pump().
    pump(set, get);
  }
}

/**
 * Emite UN solo toast-resumen cuando ya no quedan descargas activas ni en
 * cola. Individual → "X descargada"; lote → "N canciones descargadas"
 * (+ "M fallaron" si hubo errores). Evita el spam de un toast por canción.
 */
function notifyBatchComplete(get) {
  const entries = get().entries;
  const done = entries.filter((e) => e.status === 'done');
  const errored = entries.filter((e) => e.status === 'error');
  const finished = done.length + errored.length;
  // Solo cuando TODA la tanda terminó (nada queued/running).
  if (finished === 0 || finished !== entries.length) return;

  if (done.length === 1 && errored.length === 0) {
    toast.success(`"${done[0].title}" descargada`, { icon: 'ArrowDownToLine' });
  } else if (done.length > 0 && errored.length === 0) {
    toast.success(`${done.length} canciones descargadas`, { icon: 'ArrowDownToLine' });
  } else if (done.length > 0 && errored.length > 0) {
    toast.error(`${done.length} descargadas · ${errored.length} ${errored.length === 1 ? 'falló' : 'fallaron'}`);
  } else if (errored.length === 1) {
    toast.error(`Error al descargar "${errored[0].title}"`);
  } else if (errored.length > 1) {
    toast.error(`${errored.length} descargas fallaron`);
  }
}
