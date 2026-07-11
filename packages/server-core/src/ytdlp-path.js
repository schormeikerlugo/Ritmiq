/**
 * Resuelve la ruta al binario yt-dlp.
 *
 * Orden de prioridad:
 *   1. RITMIQ_YTDLP_PATH        (override explícito por env — headless)
 *   2. <dataDir>/bin/yt-dlp     (versión actualizada por el usuario)
 *   3. host.resourcesBinDir/yt-dlp  (empaquetada con la app, si aplica)
 *   4. host.devBinDir/yt-dlp    (durante desarrollo)
 *   5. 'yt-dlp'                 (fallback al PATH)
 *
 * @module @ritmiq/server-core/ytdlp-path
 */
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { getHost, dataPath } from './host.js';

/** Path writable donde guardamos actualizaciones del usuario. */
export function getYtDlpUserDataPath() {
  const dir = dataPath('bin');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'yt-dlp');
}

export function getYtDlpPath() {
  // 1. Override explícito por env (headless: RITMIQ_YTDLP_PATH=/usr/bin/yt-dlp).
  const envOverride = process.env.RITMIQ_YTDLP_PATH;
  if (envOverride && existsSync(envOverride)) return envOverride;

  // 2. Versión actualizada por el usuario (writable).
  const userPath = getYtDlpUserDataPath();
  if (existsSync(userPath)) return userPath;

  const host = getHost();

  // 3. Versión empaquetada (release desktop).
  if (host.resourcesBinDir) {
    const packed = join(host.resourcesBinDir, 'yt-dlp');
    if (existsSync(packed)) return packed;
  }

  // 4. Desarrollo.
  if (host.devBinDir) {
    const dev = join(host.devBinDir, 'yt-dlp');
    if (existsSync(dev)) return dev;
  }

  // 5. Fallback PATH.
  return 'yt-dlp';
}
