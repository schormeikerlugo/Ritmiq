/**
 * Helpers para distinguir tracks efímeros (resultados de búsqueda) de
 * tracks persistidos en la biblioteca.
 *
 * Convención: los tracks efímeros llevan `id = "yt:" + ytId`.
 * Los persistidos llevan un UUID generado al guardarlos.
 */

import { rewriteHost } from './url-rewrite.js';

/** @typedef {import('@ritmiq/core/types').Track} Track */

/** @param {string} id */
export function isEphemeralId(id) {
  return typeof id === 'string' && id.startsWith('yt:');
}

/** @param {Track} t */
export function isEphemeralTrack(t) {
  return !!t && isEphemeralId(t.id);
}

/**
 * Convierte una metadata de yt-dlp/búsqueda en un Track efímero reproducible.
 *
 * @param {{id: string, title: string, uploader?: string|null, duration?: number|null, thumbnail?: string|null}} meta
 * @returns {Track}
 */
export function metaToCandidate(meta) {
  return {
    id: `yt:${meta.id}`,
    userId: '',
    source: 'youtube',
    ytId: meta.id,
    title: meta.title,
    artist: meta.uploader ?? null,
    album: null,
    durationSeconds: meta.duration ?? null,
    coverUrl: rewriteHost(meta.thumbnail) ?? null,
    filePath: null,
    isDownloaded: false,
    createdAt: new Date().toISOString(),
  };
}
