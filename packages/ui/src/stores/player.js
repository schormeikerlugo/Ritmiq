import { create } from 'zustand';

/**
 * @typedef {import('@ritmiq/core/types').Track} Track
 */

/**
 * Cola de reproducción explícita estilo Spotify:
 * - `queue`: lista en orden actual
 * - `index`: posición del track sonando dentro de queue
 * - `currentTrack` se deriva pero lo cacheamos por conveniencia
 *
 * Acciones:
 * - playNow(track | tracks, startIdx?)  reemplaza la cola y empieza a sonar
 * - playNext(track)                     inserta en index+1 (un solo track o varios)
 * - enqueue(track | tracks)             añade al final
 * - removeFromQueue(idx)                quita por índice
 * - clearQueue()
 * - next() / prev()
 */

export const usePlayerStore = create((set, get) => ({
  /** @type {Track|null} */
  currentTrack: null,
  /** @type {Track[]} */
  queue: [],
  /** Índice actual dentro de queue (-1 si vacío) */
  index: -1,

  isPlaying: false,
  positionSeconds: 0,
  durationSeconds: 0,
  volume: 0.8,
  shuffle: false,
  /** @type {'off'|'one'|'all'} */
  repeat: 'off',
  /** @type {string|null} Mensaje de error visible al usuario */
  error: null,

  /** @param {Partial<any>} p */
  patch: (p) => set(p),

  /**
   * Reemplaza la cola y comienza a sonar.
   * Acepta un track o un array.
   * @param {Track | Track[]} input
   * @param {number} [startIdx]
   */
  playNow(input, startIdx = 0) {
    const tracks = Array.isArray(input) ? input.slice() : [input];
    if (tracks.length === 0) return;
    const idx = Math.max(0, Math.min(startIdx, tracks.length - 1));
    set({
      queue: tracks,
      index: idx,
      currentTrack: tracks[idx],
      isPlaying: true,
      positionSeconds: 0,
    });
  },

  /** Inserta un track justo después del actual. */
  playNext(track) {
    const { queue, index } = get();
    const insertAt = index < 0 ? 0 : index + 1;
    const next = queue.slice();
    next.splice(insertAt, 0, track);
    set({ queue: next });
  },

  /** Añade tracks al final de la cola. */
  enqueue(input) {
    const tracks = Array.isArray(input) ? input : [input];
    const { queue } = get();
    set({ queue: [...queue, ...tracks] });
  },

  /** Quita un elemento por índice. Si era el actual, salta al siguiente. */
  removeFromQueue(removeIdx) {
    const { queue, index } = get();
    if (removeIdx < 0 || removeIdx >= queue.length) return;
    const next = queue.slice();
    next.splice(removeIdx, 1);

    if (next.length === 0) {
      set({ queue: [], index: -1, currentTrack: null, isPlaying: false });
      return;
    }

    let nextIndex = index;
    let nextCurrent = get().currentTrack;
    let nextIsPlaying = get().isPlaying;

    if (removeIdx === index) {
      nextIndex = Math.min(index, next.length - 1);
      nextCurrent = next[nextIndex];
      nextIsPlaying = true;
    } else if (removeIdx < index) {
      nextIndex = index - 1;
    }
    set({ queue: next, index: nextIndex, currentTrack: nextCurrent, isPlaying: nextIsPlaying });
  },

  clearQueue() {
    set({ queue: [], index: -1, currentTrack: null, isPlaying: false });
  },

  /**
   * Mueve un elemento de la cola de `fromIdx` a `toIdx`. Ajusta `index`
   * para que `currentTrack` siga apuntando al mismo track despues del
   * reorder. No reproduce nada; solo reordena.
   *
   * Casos:
   *   - Si `fromIdx === index`: index se ajusta a `toIdx`.
   *   - Si fromIdx < index <= toIdx: el current "se desplaza arriba" → index--
   *   - Si toIdx <= index < fromIdx: el current "se desplaza abajo" → index++
   *
   * @param {number} fromIdx
   * @param {number} toIdx
   */
  moveQueueItem(fromIdx, toIdx) {
    const { queue, index } = get();
    if (fromIdx === toIdx) return;
    if (fromIdx < 0 || fromIdx >= queue.length) return;
    if (toIdx < 0 || toIdx >= queue.length) return;
    const next = queue.slice();
    const [item] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, item);

    let nextIndex = index;
    if (index === fromIdx) {
      nextIndex = toIdx;
    } else if (fromIdx < index && toIdx >= index) {
      nextIndex = index - 1;
    } else if (fromIdx > index && toIdx <= index) {
      nextIndex = index + 1;
    }
    set({ queue: next, index: nextIndex });
  },

  /** Avanza al siguiente track según repeat/shuffle. Devuelve true si avanzó. */
  next() {
    const { queue, index, repeat, shuffle } = get();
    if (queue.length === 0) return false;
    if (repeat === 'one') {
      // Reinicia el actual (no cambia índice; el motor reseekará)
      set({ positionSeconds: 0, isPlaying: true });
      return true;
    }
    let nextIdx;
    if (shuffle) {
      // Random distinto del actual si hay >1
      if (queue.length === 1) nextIdx = 0;
      else {
        do { nextIdx = Math.floor(Math.random() * queue.length); }
        while (nextIdx === index);
      }
    } else {
      nextIdx = index + 1;
      if (nextIdx >= queue.length) {
        if (repeat === 'all') nextIdx = 0;
        else {
          set({ isPlaying: false, positionSeconds: 0 });
          return false;
        }
      }
    }
    set({
      index: nextIdx,
      currentTrack: queue[nextIdx],
      isPlaying: true,
      positionSeconds: 0,
    });
    return true;
  },

  /** Retrocede; si llevamos >3s, reinicia el actual. */
  prev() {
    const { queue, index, positionSeconds } = get();
    if (queue.length === 0) return false;
    if (positionSeconds > 3) {
      set({ positionSeconds: 0 });
      return true;
    }
    const prevIdx = Math.max(0, index - 1);
    set({
      index: prevIdx,
      currentTrack: queue[prevIdx],
      isPlaying: true,
      positionSeconds: 0,
    });
    return true;
  },

  // ── Compatibilidad con código previo ─────────────────────────────────
  /** @param {Track} t */
  setCurrent(t) { get().playNow(t); },
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)) }),
  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
  cycleRepeat: () =>
    set((s) => ({
      repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off',
    })),
}));
