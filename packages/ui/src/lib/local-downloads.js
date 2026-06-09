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
import {
  lanStreamUrl, getLanBaseUrlSync, pingLan,
  getTunnelUrlSync, withTokenInUrl, getReachableLanBaseUrl,
  getSignedStreamUrl,
} from './lan-client.js';

class RitmiqLocalDB extends Dexie {
  constructor() {
    super('ritmiq-local');
    this.version(1).stores({
      audioBlobs: 'trackId, downloadedAt',
    });
    // v2 — cache de metadatos para funcionar 100% offline.
    //   tracks         → biblioteca del usuario (mirror de Supabase `tracks`)
    //   playlists      → playlists del usuario  (mirror de `playlists`)
    //   playlistTracks → contenido por playlist (mirror de `playlist_tracks`)
    //   meta           → key/value para timestamps y banderas de sync
    this.version(2).stores({
      audioBlobs: 'trackId, downloadedAt',
      tracks: 'id, userId, ytId, createdAt',
      playlists: 'id, userId, updatedAt',
      playlistTracks: '[playlistId+trackId], playlistId, trackId, position',
      meta: 'key',
    });
    // v3 — cola offline de reproducciones (Fase 1 recomendaciones).
    //   pendingPlays   → eventos de play que no pudieron subirse aún a
    //                    Supabase. Se reintenta al recuperar red.
    this.version(3).stores({
      audioBlobs: 'trackId, downloadedAt',
      tracks: 'id, userId, ytId, createdAt',
      playlists: 'id, userId, updatedAt',
      playlistTracks: '[playlistId+trackId], playlistId, trackId, position',
      meta: 'key',
      pendingPlays: '++id, queuedAt',
    });
    // v4 — cache EFÍMERA de audio para Jam (Bloque 3.7). Indexada por ytId
    //   (el guest no tiene el trackId del host). TTL 1h + LRU ~10 pistas.
    //   Separada de audioBlobs (descargas reales del usuario): NO aparece en
    //   la vista Descargas ni cuenta en stats. Se promueve a audioBlobs si el
    //   usuario decide descargar la canción (sin re-bajar de red).
    this.version(4).stores({
      audioBlobs: 'trackId, downloadedAt',
      tracks: 'id, userId, ytId, createdAt',
      playlists: 'id, userId, updatedAt',
      playlistTracks: '[playlistId+trackId], playlistId, trackId, position',
      meta: 'key',
      pendingPlays: '++id, queuedAt',
      jamCache: 'ytId, cachedAt',
    });
  }
}

/** TTL de la cache efímera del jam: 1 hora. */
const JAM_CACHE_TTL_MS = 60 * 60 * 1000;
/** Máximo de pistas en la cache efímera (LRU por cachedAt). */
const JAM_CACHE_MAX = 10;

export const db = new RitmiqLocalDB();

/** Cache de object URLs vivos para revocarlos al limpiar. */
const objectUrls = new Map();

let persistRequested = false;

/**
 * Solicita al navegador que el almacenamiento sea PERSISTENTE (no elegible
 * para eviction automático bajo presión de disco). Idempotente. Debe
 * llamarse temprano (al arrancar la app tras login) además de al descargar,
 * para reducir el riesgo de que el SO desaloje IndexedDB con las descargas.
 *
 * En iOS Safari la API es limitada (puede devolver false), pero pedirla
 * temprano ayuda. No lanza si no está disponible.
 */
export async function requestPersistOnce() {
  if (persistRequested) return;
  persistRequested = true;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      // Si ya es persistente, no re-pedir.
      const already = navigator.storage.persisted
        ? await navigator.storage.persisted().catch(() => false)
        : false;
      if (already) {
        console.info('[downloads] storage ya persistente');
        return;
      }
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

  // ── Prioridad para descargas:
  // 1. LAN local (rápido, sin coste).
  // 2. Cloudflare Tunnel (funciona fuera de casa, usa yt-dlp del PC).
  // 3. Edge Function `resolve-stream` (último recurso; YouTube suele bloquear
  //    Innertube desde IPs de cloud y devuelve 502, por eso lo evitamos para
  //    descargas — solo lo usamos como fallback si el usuario lo intenta sin
  //    su PC encendido).
  const reachable = await getReachableLanBaseUrl();

  let url;
  if (reachable) {
    // Pedimos URL firmada a la Edge `sign-stream`: Supabase valida JWT +
    // RLS, devuelve URL con HMAC. El LAN server NO consulta Supabase ni
    // tiene service role — solo verifica firma localmente. Si la firma
    // falla, fallback a URL con Bearer (modo compat ACCEPT_UNSIGNED).
    //
    // Para descargas usamos /download/ en lugar de /stream/: el LAN
    // server invoca yt-dlp (paralelismo HTTP nativo, ~5s para un m4a)
    // en lugar de proxiar bytes en vivo (limitado al bitrate del audio,
    // tardaría minutos). La firma HMAC es la misma — el payload no se
    // ata al endpoint, solo a (trackId, ytId, exp).
    const signed = await getSignedStreamUrl(trackId, reachable.replace(/\/$/, ''));
    // Adjuntamos ?yt=<ytId> para que el desktop pueda servir desde shared_audio
    // aunque el track no este en su SQLite local (caso device pareado de
    // otra cuenta — Modelo Y).
    const ytQs = ytId ? `?yt=${encodeURIComponent(ytId)}` : '';
    const base = signed ?? withTokenInUrl(
      `${reachable.replace(/\/$/, '')}/stream/${encodeURIComponent(trackId)}${ytQs}`
    );
    url = base.replace('/stream/', '/download/');
  } else if (ytId) {
    const sup = import.meta.env.VITE_SUPABASE_URL;
    if (!sup) throw new Error('Conecta tu PC para descargar canciones.');
    url = `${sup}/functions/v1/resolve-stream?ytId=${encodeURIComponent(ytId)}&proxy=1`;
  } else {
    throw new Error('Conecta tu PC (LAN o Tunnel) para descargar esta canción.');
  }

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    // 502 típicamente significa: estábamos usando la Edge Function y YouTube
    // bloqueó la petición desde la IP de Supabase. Mensaje útil al usuario.
    if (res.status === 502 && !reachable) {
      throw new Error(
        'YouTube bloquea descargas desde la nube. ' +
        'Enciende tu PC con Ritmiq abierto y vuelve a intentarlo.'
      );
    }
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

/* ─────────────────────────────────────────────────────────────────────
 * Cache de metadatos offline (tracks / playlists / playlist_tracks).
 * Permite que la PWA abra y muestre contenido sin red.
 * ───────────────────────────────────────────────────────────────────── */

/** @param {import('@ritmiq/core/types').Track[]} tracks */
export async function cacheTracks(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return;
  // Persistimos solo metadata (sin blob). Los flags por-dispositivo se ignoran.
  const rows = tracks.map((t) => ({
    id: t.id,
    userId: t.userId,
    source: t.source,
    ytId: t.ytId ?? null,
    title: t.title,
    artist: t.artist ?? null,
    album: t.album ?? null,
    durationSeconds: t.durationSeconds ?? null,
    coverUrl: t.coverUrl ?? null,
    createdAt: t.createdAt ?? null,
  }));
  await db.table('tracks').bulkPut(rows);
  await db.table('meta').put({ key: 'tracks.syncedAt', value: new Date().toISOString() });
}

/** @returns {Promise<import('@ritmiq/core/types').Track[]>} */
export async function getCachedTracks() {
  const rows = await db.table('tracks').toArray();
  return rows.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** @param {string} trackId */
export async function removeCachedTrack(trackId) {
  await db.table('tracks').delete(trackId);
}

/** @param {import('@ritmiq/core/types').Playlist[]} playlists */
export async function cachePlaylists(playlists) {
  if (!Array.isArray(playlists)) return;
  await db.transaction('rw', db.table('playlists'), async () => {
    await db.table('playlists').clear();
    if (playlists.length) await db.table('playlists').bulkPut(playlists);
  });
  await db.table('meta').put({ key: 'playlists.syncedAt', value: new Date().toISOString() });
}

/** @returns {Promise<import('@ritmiq/core/types').Playlist[]>} */
export async function getCachedPlaylists() {
  const rows = await db.table('playlists').toArray();
  return rows.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/** @param {Record<string,string[]>} contents */
export async function cachePlaylistContents(contents) {
  const rows = [];
  for (const [playlistId, trackIds] of Object.entries(contents ?? {})) {
    trackIds.forEach((trackId, position) => {
      rows.push({ playlistId, trackId, position });
    });
  }
  await db.transaction('rw', db.table('playlistTracks'), async () => {
    await db.table('playlistTracks').clear();
    if (rows.length) await db.table('playlistTracks').bulkPut(rows);
  });
}

/** @returns {Promise<Record<string,string[]>>} */
export async function getCachedPlaylistContents() {
  const rows = await db.table('playlistTracks').toArray();
  rows.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  /** @type {Record<string,string[]>} */
  const out = {};
  for (const r of rows) {
    (out[r.playlistId] ??= []).push(r.trackId);
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────
 * Cache efímera de audio para Jam (Bloque 3.7). Indexada por ytId.
 * TTL 1h + LRU ~10 pistas. Reproducción local sin buffering en el guest.
 * Promovible a descarga real (audioBlobs) sin re-descargar.
 * ───────────────────────────────────────────────────────────────────── */

const jamObjectUrls = new Map();

/** ¿Hay un blob de jam cacheado para este ytId (no expirado)? */
export async function hasJamCache(ytId) {
  if (!ytId) return false;
  const row = await db.table('jamCache').get(ytId);
  if (!row) return false;
  const age = Date.now() - new Date(row.cachedAt).getTime();
  return age < JAM_CACHE_TTL_MS;
}

/** Devuelve un blob: URL para un track de la cache de jam, o null. */
export async function getJamBlobUrl(ytId) {
  if (!ytId) return null;
  const cached = jamObjectUrls.get(ytId);
  if (cached) return cached;
  const row = await db.table('jamCache').get(ytId);
  if (!row?.blob) return null;
  const age = Date.now() - new Date(row.cachedAt).getTime();
  if (age >= JAM_CACHE_TTL_MS) { await db.table('jamCache').delete(ytId); return null; }
  const url = URL.createObjectURL(row.blob);
  jamObjectUrls.set(ytId, url);
  return url;
}

/**
 * Descarga un track por su URL ya resuelta y lo guarda en la cache efímera
 * del jam bajo su ytId. Idempotente (si ya existe y no expiró, no re-baja).
 * Tras guardar, aplica el barrido TTL/LRU.
 *
 * @param {string} ytId
 * @param {string} url URL de stream ya resuelta (cache global / cloud)
 * @returns {Promise<{size:number}|null>}
 */
export async function cacheJamTrack(ytId, url) {
  if (!ytId || !url) return null;
  if (await hasJamCache(ytId)) return null; // ya cacheado
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) return null;
    const mime = res.headers.get('content-type') ?? 'audio/mp4';
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], { type: mime });
    await db.table('jamCache').put({
      ytId, blob, mime, size: blob.size, cachedAt: new Date().toISOString(),
    });
    await sweepJamCache();
    return { size: blob.size };
  } catch {
    return null;
  }
}

/** Barrido de la cache efímera: elimina expirados (TTL) y aplica LRU (max). */
export async function sweepJamCache() {
  const rows = await db.table('jamCache').toArray();
  const now = Date.now();
  const expired = rows.filter((r) => now - new Date(r.cachedAt).getTime() >= JAM_CACHE_TTL_MS);
  for (const r of expired) await removeJamCache(r.ytId);

  const live = rows
    .filter((r) => now - new Date(r.cachedAt).getTime() < JAM_CACHE_TTL_MS)
    .sort((a, b) => (b.cachedAt ?? '').localeCompare(a.cachedAt ?? '')); // recientes primero
  for (const r of live.slice(JAM_CACHE_MAX)) await removeJamCache(r.ytId);
}

/** Elimina una entrada de la cache efímera + revoca su object URL. */
export async function removeJamCache(ytId) {
  const url = jamObjectUrls.get(ytId);
  if (url) { try { URL.revokeObjectURL(url); } catch {} jamObjectUrls.delete(ytId); }
  await db.table('jamCache').delete(ytId);
}

/**
 * Promueve un track cacheado en jamCache a descarga REAL (audioBlobs) sin
 * re-descargar. Devuelve true si se reutilizó el blob; false si no había
 * cache (el caller debe descargar normal).
 *
 * @param {string} ytId
 * @param {string} trackId id del track en la biblioteca del usuario
 * @returns {Promise<boolean>}
 */
export async function promoteJamCacheToDownload(ytId, trackId) {
  if (!ytId || !trackId) return false;
  const row = await db.table('jamCache').get(ytId);
  if (!row?.blob) return false;
  const age = Date.now() - new Date(row.cachedAt).getTime();
  if (age >= JAM_CACHE_TTL_MS) { await removeJamCache(ytId); return false; }
  await db.table('audioBlobs').put({
    trackId, blob: row.blob, mime: row.mime,
    size: row.size, downloadedAt: new Date().toISOString(),
  });
  // El blob ya vive en audioBlobs; lo quitamos de la cache efímera.
  await removeJamCache(ytId);
  const old = objectUrls.get(trackId);
  if (old) { try { URL.revokeObjectURL(old); } catch {} objectUrls.delete(trackId); }
  requestPersistOnce();
  return true;
}

/** Borra toda la cache efímera del jam. */
export async function clearJamCache() {
  for (const url of jamObjectUrls.values()) { try { URL.revokeObjectURL(url); } catch {} }
  jamObjectUrls.clear();
  await db.table('jamCache').clear();
}

/** Borra todas las descargas locales (útil para vista de Downloads "limpiar"). */
export async function clearAllLocal() {
  for (const url of objectUrls.values()) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  objectUrls.clear();
  await db.table('audioBlobs').clear();
}
