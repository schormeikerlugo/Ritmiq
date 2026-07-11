/**
 * Host de ejecución del server-core.
 *
 * El servidor LAN (búsqueda/resolución/stream de YouTube) es lógica Node
 * pura, pero necesita dos cosas que dependen del entorno:
 *
 *   - `dataDir`: carpeta writable donde persistir SQLite, cookies cacheadas,
 *     access-token, shared-audio, yt-dlp-cache, etc. En Electron es
 *     `app.getPath('userData')`; en el servidor headless es una ruta
 *     configurable (`RITMIQ_DATA_DIR`).
 *   - `safeStorage`: cifrado de secretos (cookies por dispositivo). En
 *     Electron es `electron.safeStorage` (keyring del OS); en headless se
 *     puede dejar `null` (fallback a texto plano con permisos 0600).
 *
 * Cada app (desktop / server) llama `setHost(...)` UNA vez al arrancar,
 * ANTES de usar cualquier otro módulo de server-core. Así ni `lan-server`
 * ni `db` ni `device-cookies` importan `electron` directamente.
 *
 * @module @ritmiq/server-core/host
 */

import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * @typedef {Object} SafeStorageLike
 * @property {() => boolean} isEncryptionAvailable
 * @property {(plain: string) => Buffer} encryptString
 * @property {(blob: Buffer) => string} decryptString
 */

/**
 * @typedef {Object} HostConfig
 * @property {string} dataDir  Carpeta writable de datos.
 * @property {SafeStorageLike|null} [safeStorage]  Cifrado del OS, o null.
 * @property {string|null} [resourcesBinDir]  Carpeta de binarios empaquetados
 *   (yt-dlp/cloudflared) cuando la app está empaquetada. null si no aplica.
 * @property {string|null} [devBinDir]  Carpeta de binarios en desarrollo.
 */

/** @type {HostConfig|null} */
let host = null;

/**
 * Configura el host. Idempotente: la última llamada gana.
 * @param {HostConfig} cfg
 */
export function setHost(cfg) {
  if (!cfg || !cfg.dataDir) {
    throw new Error('[server-core/host] setHost requiere { dataDir }');
  }
  try { mkdirSync(cfg.dataDir, { recursive: true }); } catch {}
  host = {
    dataDir: cfg.dataDir,
    safeStorage: cfg.safeStorage ?? null,
    resourcesBinDir: cfg.resourcesBinDir ?? null,
    devBinDir: cfg.devBinDir ?? null,
  };
}

/** @returns {HostConfig} */
export function getHost() {
  if (!host) {
    throw new Error(
      '[server-core/host] host no configurado. Llama setHost({ dataDir, ... }) al arrancar.'
    );
  }
  return host;
}

/** @returns {boolean} */
export function isHostReady() {
  return host !== null;
}

/**
 * Ruta writable dentro de dataDir, creando subdirectorios si hace falta.
 * @param {...string} segments
 * @returns {string}
 */
export function dataPath(...segments) {
  const h = getHost();
  const full = join(h.dataDir, ...segments);
  return full;
}

/**
 * Devuelve una subcarpeta de dataDir asegurando que existe.
 * @param {string} name
 * @returns {string}
 */
export function dataSubdir(name) {
  const h = getHost();
  const dir = join(h.dataDir, name);
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}
