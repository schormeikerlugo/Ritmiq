/**
 * Resuelve la ruta al binario yt-dlp embebido en la app.
 * En desarrollo: apps/desktop/bin/yt-dlp
 * Empaquetado: process.resourcesPath/bin/yt-dlp
 */

import { app } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getYtDlpPath() {
  // Empaquetado
  if (app.isPackaged) {
    const packed = join(process.resourcesPath, 'bin', 'yt-dlp');
    if (existsSync(packed)) return packed;
  }
  // Desarrollo
  const dev = join(__dirname, '..', 'bin', 'yt-dlp');
  if (existsSync(dev)) return dev;
  // Fallback: confiar en PATH
  return 'yt-dlp';
}
