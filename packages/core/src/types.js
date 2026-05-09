/**
 * Tipos compartidos del dominio Ritmiq (vía JSDoc).
 * @module @ritmiq/core/types
 */

/**
 * @typedef {'youtube' | 'local'} TrackSource
 */

/**
 * @typedef {Object} Track
 * @property {string} id              UUID
 * @property {string} userId
 * @property {TrackSource} source
 * @property {string|null} ytId       ID de YouTube si source==='youtube'
 * @property {string} title
 * @property {string|null} artist
 * @property {string|null} album
 * @property {number|null} durationSeconds
 * @property {string|null} coverUrl
 * @property {string|null} filePath   Path local en desktop, null en PWA
 * @property {boolean} isDownloaded
 * @property {string} createdAt       ISO timestamp
 */

/**
 * @typedef {Object} Playlist
 * @property {string} id
 * @property {string} userId
 * @property {string} name
 * @property {boolean} isOffline      true ⇒ "Smart Download": pre-descargar todo
 * @property {string} createdAt
 */

/**
 * @typedef {Object} PlaybackState
 * @property {Track|null} currentTrack
 * @property {boolean} isPlaying
 * @property {number} positionSeconds
 * @property {number} volume          0..1
 * @property {'off'|'one'|'all'} repeat
 * @property {boolean} shuffle
 */

/**
 * @typedef {Object} AudioSourceResult
 * @property {string} url             URL reproducible (file://, blob:, http:, https:)
 * @property {'local-file'|'local-blob'|'lan'|'cloud-stream'} origin
 * @property {number} [expiresAt]     Epoch ms cuando la URL caduca (solo cloud)
 */

export {};
