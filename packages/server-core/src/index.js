/**
 * @ritmiq/server-core — lógica del servidor LAN (búsqueda/resolución/stream
 * de YouTube vía yt-dlp) desacoplada de Electron. La consumen tanto la app
 * desktop (Electron) como el servidor headless 24/7 (apps/server).
 *
 * Cada app configura el entorno una sola vez con `setHost({ dataDir, ... })`
 * ANTES de llamar a `initDb()` / `startLanServer()`.
 *
 * @module @ritmiq/server-core
 */
export { setHost, getHost, isHostReady, dataPath, dataSubdir } from './host.js';
export { initDb } from './db.js';
export { getOrCreateAccessToken, regenerateAccessToken } from './access-token.js';
export { getYtDlpPath, getYtDlpUserDataPath } from './ytdlp-path.js';
export { detectCookiesBrowser, detectJsRuntime, getCookieFilePath, exportCookiesToFile } from './cookies-detect.js';
export {
  startLanServer,
  setPublishUrlCacheEnabled,
  setSupabaseUserJwt,
  getPublishStats,
  clearStreamCache,
  publishResolvedUrl,
  publishTrackMetaFromMain,
} from './lan-server.js';
export {
  createPairRequest, approveDevice, rejectPairRequest,
  revokeDevice, renameDevice, getPairStatus,
  findDeviceByToken, listDevices, listPairRequests,
  logActivity, pruneOldActivity, updateDeviceCookies, clearDeviceCookies,
  getDeviceActivity, forgetDevice,
} from './devices.js';
export {
  encryptCookies, decryptCookies, getCookieFileForDevice,
  invalidateDeviceCookies, looksLikeCookieExpired,
} from './device-cookies.js';
