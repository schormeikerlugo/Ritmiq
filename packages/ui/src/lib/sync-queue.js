/**
 * Cola FIFO persistida de mutaciones que no pudieron sincronizarse.
 * Se almacena en localStorage. Operaciones soportadas:
 *
 *   - { kind: 'track.upsert',         payload: Track }
 *   - { kind: 'track.delete',         payload: { id } }
 *   - { kind: 'playlist.upsert',      payload: Playlist }
 *   - { kind: 'playlist.delete',      payload: { id } }
 *   - { kind: 'playlist_track.add',   payload: { playlistId, trackId, position } }
 *   - { kind: 'playlist_track.remove',payload: { playlistId, trackId } }
 *   - { kind: 'playlist_track.reorder',payload: { playlistId, orderedTrackIds } }
 *
 * `kind` y `payload` se ejecutan contra Supabase al drenar la cola.
 */

import {
  pushTrack, deleteTrackRemote,
  pushPlaylist, deletePlaylistRemote,
  pushPlaylistTrack, removePlaylistTrackRemote, reorderPlaylistRemote,
} from './sync.js';

const STORAGE_KEY = 'ritmiq:syncQueue';
const MAX_ATTEMPTS = 8;

/** @type {Set<(size:number)=>void>} */
const sizeListeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function write(ops) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
    for (const cb of sizeListeners) { try { cb(ops.length); } catch {} }
  } catch {}
}

/** @param {(size:number)=>void} cb */
export function onQueueSizeChange(cb) {
  sizeListeners.add(cb);
  queueMicrotask(() => cb(read().length));
  return () => sizeListeners.delete(cb);
}

export function queueSize() { return read().length; }

/**
 * Encola una operación. Llamar cuando una mutación remota falle por red.
 * @param {{kind: string, payload: any}} op
 */
export function enqueue(op) {
  const ops = read();
  ops.push({
    id: cryptoRandomId(),
    kind: op.kind,
    payload: op.payload,
    ts: new Date().toISOString(),
    attempts: 0,
  });
  write(ops);
}

let flushing = false;

/**
 * Procesa la cola en orden FIFO. No corre en paralelo consigo mismo.
 * Devuelve cuántas operaciones se aplicaron correctamente.
 */
export async function flushQueue() {
  if (flushing) return 0;
  flushing = true;
  let applied = 0;
  try {
    let ops = read();
    while (ops.length > 0) {
      const op = ops[0];
      try {
        await applyOp(op);
        ops = ops.slice(1);
        write(ops);
        applied++;
      } catch (err) {
        // Reintentar con backoff implícito (sólo bumpea attempts)
        op.attempts = (op.attempts ?? 0) + 1;
        if (op.attempts >= MAX_ATTEMPTS) {
          console.warn('[sync-queue] descartada tras max attempts', op, err);
          ops = ops.slice(1);
        } else {
          ops[0] = op;
        }
        write(ops);
        // Salir del loop: si esta falló, las siguientes probablemente también.
        break;
      }
    }
  } finally {
    flushing = false;
  }
  return applied;
}

/** @param {any} op */
async function applyOp(op) {
  switch (op.kind) {
    case 'track.upsert':            return pushTrack(op.payload);
    case 'track.delete':            return deleteTrackRemote(op.payload.id);
    case 'playlist.upsert':         return pushPlaylist(op.payload);
    case 'playlist.delete':         return deletePlaylistRemote(op.payload.id);
    case 'playlist_track.add':      return pushPlaylistTrack(op.payload.playlistId, op.payload.trackId, op.payload.position);
    case 'playlist_track.remove':   return removePlaylistTrackRemote(op.payload.playlistId, op.payload.trackId);
    case 'playlist_track.reorder':  return reorderPlaylistRemote(op.payload.playlistId, op.payload.orderedTrackIds);
    default:
      console.warn('[sync-queue] kind desconocido', op.kind);
  }
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch {}
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Helper genérico: intenta `fn()`. Si tira por red, encola `op` y devuelve
 * silenciosamente (no relanza). Útil para envolver llamadas de mutación.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{kind:string,payload:any}} op
 */
export async function tryOrQueue(fn, op) {
  try {
    return await fn();
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue(op);
      return null;
    }
    throw err;
  }
}

function isNetworkError(err) {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('load failed') ||
    err?.name === 'TypeError' ||
    err?.code === 'ECONNREFUSED'
  );
}
