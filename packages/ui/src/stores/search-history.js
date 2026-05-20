/**
 * Historial de busquedas — persiste las ultimas N queries del usuario.
 *
 * Reglas:
 *   - Maximo 8 entradas.
 *   - Dedupe: registrar la misma query la mueve al top (LRU).
 *   - Trim + lowercase para deduplicar diferencias triviales.
 *   - Persistencia en localStorage clave `ritmiq.search-history`.
 *
 * @module @ritmiq/ui/stores/search-history
 */
import { create } from 'zustand';

const LS_KEY = 'ritmiq.search-history';
const MAX = 8;

function readInitial() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((q) => typeof q === 'string').slice(0, MAX);
  } catch {
    return [];
  }
}

function persist(arr) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch {}
}

export const useSearchHistoryStore = create((set, get) => ({
  /** @type {string[]} ordenadas de mas reciente a mas antigua. */
  recents: readInitial(),

  /**
   * Registra una query. Se descarta si esta vacia o es URL/ID directa
   * (eso no es una busqueda, es una accion de pegar).
   * @param {string} query
   */
  record: (query) => {
    const q = (query ?? '').trim();
    if (!q || q.length < 2) return;
    // Filtrar URL/ID directas — no son busquedas semanticas que valga la
    // pena recordar. Reusa la misma regex del TopBar.
    if (/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]{11}|^[\w-]{11}$/.test(q)) {
      return;
    }
    const norm = q.toLowerCase();
    const prev = get().recents;
    const filtered = prev.filter((r) => r.toLowerCase() !== norm);
    const next = [q, ...filtered].slice(0, MAX);
    persist(next);
    set({ recents: next });
  },

  /** Borra una query especifica. */
  remove: (query) => {
    const next = get().recents.filter((r) => r !== query);
    persist(next);
    set({ recents: next });
  },

  /** Limpia el historial completo. */
  clear: () => {
    persist([]);
    set({ recents: [] });
  },
}));
