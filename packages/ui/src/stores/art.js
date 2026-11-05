/**
 * Portadas oficiales y fotos de artista (resueltas por el servidor, ver
 * packages/server-core/src/art-resolver.js y la tabla Supabase `track_art`).
 *
 * Flujo por canción (ytId):
 *   1. Caché local (memoria + localStorage).
 *   2. Supabase `track_art` en lotes (lo ya identificado por cualquiera).
 *   3. Si no existe: se pide al servidor (`/art/resolve`) y se vuelve a mirar
 *      a los ~8 s y ~25 s. Los "no encontrado" también se recuerdan.
 *
 * Las portadas puestas a mano (coverUrl que no es miniatura de YouTube)
 * siempre ganan: ver lib/track-art.js.
 *
 * @module @ritmiq/ui/stores/art
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';
import { artResolve } from '../lib/lan-client.js';

const LS_KEY = 'ritmiq:art:v1';
const MAX_SAVED = 2500;
const BATCH_MS = 120;
const RECHECK_MS = [8000, 25000];

/**
 * @typedef {{ s: 'found'|'none', c?: string|null, cs?: string|null, a?: string|null, t?: string|null, ar?: string|null, al?: string|null }} ArtEntry
 * c = portada 1000 px, cs = 300 px, a = foto artista, t/ar/al = título/artista/álbum oficiales
 */

function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; }
}
let saveTimer = null;
function save(entries) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const keys = Object.keys(entries);
      const slim = {};
      for (const k of keys.slice(-MAX_SAVED)) slim[k] = entries[k];
      localStorage.setItem(LS_KEY, JSON.stringify(slim));
    } catch { /* lleno: se ignora */ }
  }, 1500);
}

/** fila track_art / art_cache → entrada compacta */
function toEntry(r) {
  return r.status === 'found'
    ? { s: 'found', c: r.cover_url, cs: r.cover_small_url ?? r.cover_url, a: r.artist_image_url ?? null, t: r.matched_title ?? null, ar: r.matched_artist ?? null, al: r.album ?? null }
    : { s: 'none', a: r.artist_image_url ?? null };
}

/** @type {Map<string, { ytId: string, title?: string, artist?: string, durationSeconds?: number|null }>} */
const wanted = new Map();
const inflight = new Set();
let priorityId = null;
let flushTimer = null;

export const useArtStore = create((set, get) => ({
  /** @type {Record<string, ArtEntry>} */
  entries: load(),

  /** Pide la portada de una canción (idempotente; se agrupan en lotes). */
  want(track, { priority = false } = {}) {
    const ytId = track?.ytId;
    if (!ytId || get().entries[ytId] || inflight.has(ytId) || wanted.has(ytId)) return;
    wanted.set(ytId, { ytId, title: track.title ?? '', artist: track.artist ?? '', durationSeconds: track.durationSeconds ?? null });
    if (priority) priorityId = ytId;
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; get()._flush(); }, BATCH_MS);
  },

  _merge(rows) {
    if (!rows.length) return;
    const entries = { ...get().entries };
    for (const r of rows) entries[r.yt_id] = toEntry(r);
    set({ entries });
    save(entries);
  },

  async _lookup(ids) {
    const found = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase.from('track_art')
        .select('yt_id, status, cover_url, cover_small_url, artist_image_url, matched_title, matched_artist, album')
        .in('yt_id', ids.slice(i, i + 100));
      if (data) found.push(...data);
    }
    get()._merge(found);
    return new Set(found.map((r) => r.yt_id));
  },

  async _flush() {
    const batch = [...wanted.values()];
    wanted.clear();
    if (!batch.length) return;
    for (const t of batch) inflight.add(t.ytId);
    try {
      const have = await get()._lookup(batch.map((t) => t.ytId));
      const missing = batch.filter((t) => !have.has(t.ytId) && t.title);
      if (missing.length) {
        // La que suena, delante en la cola del servidor.
        const pri = missing.some((t) => t.ytId === priorityId);
        const res = await artResolve(missing.slice(0, 200), { priority: pri });
        if (res?.known) {
          get()._merge(Object.entries(res.known).map(([yt_id, r]) => ({ ...r, yt_id })));
        }
        const still = missing.filter((t) => !get().entries[t.ytId]).map((t) => t.ytId);
        for (const ms of RECHECK_MS) {
          if (!still.length) break;
          await new Promise((r) => setTimeout(r, ms));
          const got = await get()._lookup(still.filter((id) => !get().entries[id]));
          for (const id of got) still.splice(still.indexOf(id), 1);
        }
      }
    } catch { /* sin red: se reintenta en otra visita */ }
    finally {
      for (const t of batch) inflight.delete(t.ytId);
    }
  },
}));
