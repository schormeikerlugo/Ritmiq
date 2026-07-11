/**
 * Configuración del servidor headless. Resuelve el directorio de datos y
 * el puerto desde variables de entorno con valores por defecto sensatos.
 *
 * @module @ritmiq/server/config
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Carpeta writable donde persistir SQLite, cookies, tokens, audio. */
export function resolveDataDir() {
  if (process.env.RITMIQ_DATA_DIR) return process.env.RITMIQ_DATA_DIR;
  // XDG-friendly default en Linux/macOS.
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return join(xdg, 'ritmiq-server');
  return join(homedir(), '.local', 'share', 'ritmiq-server');
}

/** Puerto HTTP del LAN server (default 3939, igual que el desktop). */
export function resolvePort() {
  const p = Number(process.env.RITMIQ_PORT ?? process.env.VITE_LAN_DEFAULT_PORT ?? 3939);
  return Number.isFinite(p) && p > 0 ? p : 3939;
}
