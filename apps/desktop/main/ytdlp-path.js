/**
 * Resuelve la ruta al binario yt-dlp.
 *
 * Orden de prioridad:
 *   1. userData/bin/yt-dlp  (versión actualizada por el usuario via Settings)
 *   2. process.resourcesPath/bin/yt-dlp  (versión empaquetada con la app)
 *   3. apps/desktop/bin/yt-dlp  (durante desarrollo)
 *   4. 'yt-dlp' (fallback al PATH)
 */

import { app } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Path donde guardamos las actualizaciones del usuario (writable).
 */
export function getYtDlpUserDataPath() {
  const dir = join(app.getPath('userData'), 'bin');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'yt-dlp');
}

export function getYtDlpPath() {
  // 1. Versión actualizada por el usuario.
  const userPath = getYtDlpUserDataPath();
  if (existsSync(userPath)) return userPath;

  // 2. Versión empaquetada (release).
  if (app.isPackaged) {
    const packed = join(process.resourcesPath, 'bin', 'yt-dlp');
    if (existsSync(packed)) return packed;
  }

  // 3. Desarrollo.
  const dev = join(__dirname, '..', 'bin', 'yt-dlp');
  if (existsSync(dev)) return dev;

  // 4. Fallback PATH.
  return 'yt-dlp';
}
