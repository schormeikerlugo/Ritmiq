/**
 * Cookies de YouTube por dispositivo.
 *
 * - Las cookies se almacenan cifradas en `devices.cookies_blob` (BLOB).
 * - Usamos Electron `safeStorage` (keyring del OS) cuando esta disponible.
 *   Fallback: plaintext con warning en logs.
 * - Para yt-dlp escribimos cada device a un archivo temporal en
 *   `userData/device-cookies/<device_id>.txt` y le pasamos `--cookies`.
 *
 * @module main/device-cookies
 */

import { app, safeStorage } from 'electron';
import { mkdirSync, writeFileSync, chmodSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

let safeStorageReady = false;
let safeStorageWarned = false;

function isSafeStorageReady() {
  if (safeStorageReady) return true;
  try {
    if (safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
      safeStorageReady = true;
      return true;
    }
  } catch {}
  if (!safeStorageWarned) {
    console.warn(
      '[device-cookies] safeStorage no disponible — cookies se guardan en plaintext. ' +
      'Asegura un keyring del OS (gnome-keyring, kwallet, macOS Keychain, ' +
      'Windows DPAPI) para activar cifrado.'
    );
    safeStorageWarned = true;
  }
  return false;
}

/**
 * Cifra una string de cookies y devuelve Buffer.
 * @param {string} plain
 * @returns {Buffer}
 */
export function encryptCookies(plain) {
  if (!plain) return Buffer.alloc(0);
  if (isSafeStorageReady()) {
    return safeStorage.encryptString(plain);
  }
  // Marca "plain:" en los primeros 6 bytes para distinguir en decrypt.
  return Buffer.concat([Buffer.from('plain:', 'utf8'), Buffer.from(plain, 'utf8')]);
}

/**
 * Descifra cookies (Buffer) a su contenido original.
 * @param {Buffer|null|undefined} blob
 * @returns {string|null}
 */
export function decryptCookies(blob) {
  if (!blob || blob.length === 0) return null;
  if (blob.length >= 6 && blob.slice(0, 6).toString('utf8') === 'plain:') {
    return blob.slice(6).toString('utf8');
  }
  if (isSafeStorageReady()) {
    try { return safeStorage.decryptString(blob); }
    catch (err) {
      console.warn('[device-cookies] decrypt failed:', err.message);
      return null;
    }
  }
  // Si llega aqui es que el cifrado se hizo con safeStorage en una sesion
  // anterior pero ahora no esta disponible (keyring caido). No podemos
  // descifrar. Tratar como sin cookies para fallback.
  return null;
}

/**
 * Cache en memoria de paths ya escritos al disco para evitar I/O
 * repetidos. Invalida cuando `cookies_updated_at` cambia.
 * @type {Map<string, { path: string, updatedAt: string }>}
 */
const fileCache = new Map();

function cookiesDir() {
  const d = join(app.getPath('userData'), 'device-cookies');
  try { mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

/**
 * Devuelve un path con las cookies del device en formato Netscape para
 * pasarselo a yt-dlp via --cookies. Si no hay cookies del device,
 * devuelve null.
 *
 * @param {{ device_id: string, cookies_blob: Buffer|null, cookies_updated_at: string|null }} device
 * @returns {string|null}
 */
export function getCookieFileForDevice(device) {
  if (!device?.cookies_blob) return null;
  const updatedAt = device.cookies_updated_at ?? '';
  const hit = fileCache.get(device.device_id);
  if (hit && hit.updatedAt === updatedAt && existsSync(hit.path)) {
    return hit.path;
  }
  const text = decryptCookies(device.cookies_blob);
  if (!text) return null;
  const p = join(cookiesDir(), `${device.device_id}.txt`);
  writeFileSync(p, text, { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(p, 0o600); } catch {}
  fileCache.set(device.device_id, { path: p, updatedAt });
  return p;
}

/**
 * Borra el archivo cacheado de un device (al revocar o al actualizar).
 * @param {string} deviceId
 */
export function invalidateDeviceCookies(deviceId) {
  const hit = fileCache.get(deviceId);
  if (hit?.path && existsSync(hit.path)) {
    try { unlinkSync(hit.path); } catch {}
  }
  fileCache.delete(deviceId);
}

/**
 * Detecta si las cookies de un device estan caducadas examinando errores
 * tipicos de yt-dlp. Solo se llama desde el wrapper cuando un download
 * falla con HTTP 401/403 en youtube.com.
 *
 * @param {string} stderrOutput
 * @returns {boolean}
 */
export function looksLikeCookieExpired(stderrOutput) {
  if (!stderrOutput) return false;
  const lower = String(stderrOutput).toLowerCase();
  return (
    lower.includes('sign in to confirm') ||
    lower.includes('age-restricted') ||
    lower.includes('http error 401') ||
    lower.includes('http error 403') ||
    lower.includes('login required') ||
    lower.includes('http_403_forbidden')
  );
}
