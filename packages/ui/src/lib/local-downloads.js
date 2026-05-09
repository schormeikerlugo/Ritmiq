/**
 * Gestor de descargas locales en IndexedDB para la PWA.
 *
 * Cada track descargado se guarda como un Blob en IndexedDB. Al reproducir,
 * `getLocalBlobUrl` devuelve un `blob:` URL que el reproductor consume sin
 * pasar por la red.
 *
 * Esquema:
 *   audioBlobs: { trackId, blob, mime, size, downloadedAt }
 */

import Dexie from 'dexie';
import { lanStreamUrl, getLanBaseUrlSync, pingLan } from './lan-client.js';

class RitmiqLocalDB extends Dexie {
  constructor() {
    super('ritmiq-local');
    this.version(1).stores({
      audioBlobs: 'trackId, downloadedAt',
    });
  }
}

const db = new RitmiqLocalDB();

/** Cache de object URLs vivos para revocarlos al limpiar. */
const objectUrls = new Map();

let persistRequested = false;

async function requestPersistOnce() {
  if (persistRequested) return;
  persistRequested = true;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      console.info('[downloads] storage.persist():', granted);
    }
  } catch {}
}

/**
 * Verifica si un track está descargado localmente.
 * @param {string} trackId
 * @returns {Promise<boolean>}
 */
export async function isLocallyDownloaded(trackId) {
  if (!trackId) return false;
  const row = await db.table('audioBlobs').get(trackId);
  return !!row;
}

/**
 * Devuelve la lista de IDs descargados localmente.
 * @returns {Promise<Set<string>>}
 */
export async function listLocalIds() {
  const rows = await db.table('audioBlobs').toArray();
  return new Set(rows.map((r) => r.trackId));
}

/**
 * Devuelve la lista completa de descargas locales (con metadata).
 * @returns {Promise<Array<{trackId:string,size:number,mime:string,downloadedAt:string}>>}
 */
export async function listLocalDownloads() {
  const rows = await db.table('audioBlobs').toArray();
  return rows.map((r) => ({
    trackId: r.trackId,
    size: r.size,
    mime: r.mime,
    downloadedAt: r.downloadedAt,
  })).sort((a, b) => (b.downloadedAt ?? '').localeCompare(a.downloadedAt ?? ''));
}

/**
 * Devuelve un blob: URL reproducible para un track descargado, o null.
 * @param {string} trackId
 * @returns {Promise<string|null>}
 */
export async function getLocalBlobUrl(trackId) {
  const cached = objectUrls.get(trackId);
  if (cached) return cached;
  const row = await db.table('audioBlobs').get(trackId);
  if (!row?.blob) return null;
  const url = URL.createObjectURL(row.blob);
  objectUrls.set(trackId, url);
  return url;
}

/**
 * Borra la descarga local de un track.
 * @param {string} trackId
 */
export async function removeLocal(trackId) {
  const url = objectUrls.get(trackId);
  if (url) { try { URL.revokeObjectURL(url); } catch {} objectUrls.delete(trackId); }
  await db.table('audioBlobs').delete(trackId);
}

/**
 * Tamaño de la descarga local en bytes (0 si no existe).
 * @param {string} trackId
 */
export async function getLocalSize(trackId) {
  const row = await db.table('audioBlobs').get(trackId);
  return row?.size ?? 0;
}

/**
 * Estimación de uso/quota del almacenamiento de la PWA.
 * @returns {Promise<{usage:number,quota:number}>}
 */
export async function storageEstimate() {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  }
  return { usage: 0, quota: 0 };
}

/**
 * Descarga el audio de un track y lo guarda en IndexedDB.
 * Prioridad: LAN server → Edge Function resolve-stream (fallback cloud).
 *
 * @param {string} trackId
 * @param {(pct:number) => void} [onProgress]
 * @param {{ ytId?: string }} [opts]
 * @returns {Promise<{size:number, mime:string}>}
 */
export async function downloadTrackToLocal(trackId, onProgress, opts = {}) {
  const { ytId } = opts;
  const base = getLanBaseUrlSync();
  const lanReady = base && (await pingLan(base));

  let url;
  if (lanReady) {
    url = lanStreamUrl(trackId);
  } else if (ytId) {
    const sup = import.meta.env.VITE_SUPABASE_URL;
    if (!sup) throw new Error('Sin LAN ni Supabase configurado');
    url = `${sup}/functions/v1/resolve-stream?ytId=${encodeURIComponent(ytId)}&proxy=1`;
  } else {
    throw new Error('Sin LAN y sin ytId — no se puede descargar');
  }

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Descarga fallida (${res.status})`);
  }

  const total = Number(res.headers.get('content-length') ?? 0);
  const mime = res.headers.get('content-type') ?? 'audio/mp4';

  const reader = res.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0 && onProgress) onProgress((received / total) * 100);
  }
  if (onProgress) onProgress(100);

  const blob = new Blob(chunks, { type: mime });
  await db.table('audioBlobs').put({
    trackId,
    blob,
    mime,
    size: blob.size,
    downloadedAt: new Date().toISOString(),
  });

  // Revocar object URL viejo si lo había, así la próxima reproducción usa el nuevo blob.
  const old = objectUrls.get(trackId);
  if (old) { try { URL.revokeObjectURL(old); } catch {} objectUrls.delete(trackId); }

  // Solicitar persistencia de almacenamiento solo una vez.
  requestPersistOnce();

  return { size: blob.size, mime };
}

/** Borra todas las descargas locales (útil para vista de Downloads "limpiar"). */
export async function clearAllLocal() {
  for (const url of objectUrls.values()) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  objectUrls.clear();
  await db.table('audioBlobs').clear();
}
