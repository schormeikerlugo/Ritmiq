/**
 * Adapter IndexedDB (Dexie) para la PWA.
 * Almacena metadata + blobs de audio descargados + cola de sync.
 *
 * @module @ritmiq/db/dexie
 */

import Dexie from 'dexie';

/**
 * @typedef {import('@ritmiq/core/types').Track} Track
 */

export class RitmiqDexie extends Dexie {
  constructor() {
    super('ritmiq');
    this.version(1).stores({
      tracks: 'id, userId, ytId, isDownloaded, createdAt',
      playlists: 'id, userId, createdAt',
      playlistTracks: '[playlistId+trackId], playlistId, trackId, position',
      playHistory: 'id, userId, trackId, playedAt',
      audioBlobs: 'trackId',          // { trackId, blob, mime, size }
      syncQueue: 'id, createdAt',
    });
  }

  /** @param {Track} t */
  async putTrack(t) {
    return this.table('tracks').put(t);
  }

  /** @param {string} userId */
  async listTracks(userId) {
    return this.table('tracks').where('userId').equals(userId).reverse().sortBy('createdAt');
  }

  /**
   * @param {string} trackId
   * @returns {Promise<string|null>} object URL para reproducir, o null
   */
  async getLocalUrl(trackId) {
    const row = await this.table('audioBlobs').get(trackId);
    if (!row) return null;
    return URL.createObjectURL(row.blob);
  }

  /** @param {string} trackId @param {Blob} blob */
  async storeAudioBlob(trackId, blob) {
    return this.table('audioBlobs').put({
      trackId,
      blob,
      mime: blob.type,
      size: blob.size,
    });
  }
}
