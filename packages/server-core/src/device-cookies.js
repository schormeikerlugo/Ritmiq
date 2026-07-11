/**
 * Cookies de YouTube por dispositivo.
 *
 * - Las cookies se almacenan cifradas en `devices.cookies_blob` (BLOB).
 * - Usamos el `safeStorage` del host (keyring del OS vía Electron) cuando
 *   está disponible. En headless (host.safeStorage === null) se usa el
 *   fallback plaintext con permisos 0600 en un FS protegido.
 * - Para yt-dlp escribimos cada device a un archivo temporal en
 *   `<dataDir>/device-cookies/<device_id>.txt` y le pasamos `--cookies`.
 *
 * @module @ritmiq/server-core/device-cookies
 */
import { writeFileSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getHost, dataSubdir } from './host.js';

let safeStorageWarned = false;

// Prefijos de esquema (primeros bytes del blob) para distinguir cómo se cifró:
//   'plain:' → texto plano (fallback headless sin key).
//   'agcm1:' → AES-256-GCM con clave derivada de RITMIQ_COOKIES_KEY.
//   (sin prefijo) → blob binario de Electron safeStorage.
const PLAIN_PREFIX = Buffer.from('plain:', 'utf8');
const AGCM_PREFIX = Buffer.from('agcm1:', 'utf8');

/** Clave AES-256 derivada de RITMIQ_COOKIES_KEY (o null si no está). */
function getAesKey() {
  const raw = process.env.RITMIQ_COOKIES_KEY;
  if (!raw) return null;
  // Derivación simple y determinista: SHA-256 de la passphrase → 32 bytes.
  return createHash('sha256').update(String(raw), 'utf8').digest();
}

/**
 * Cifra texto con AES-256-GCM. Formato del blob:
 *   AGCM_PREFIX | iv(12) | authTag(16) | ciphertext
 * @param {string} plain
 * @param {Buffer} key
 * @returns {Buffer}
 */
function aesEncrypt(plain, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([AGCM_PREFIX, iv, tag, ct]);
}

/**
 * Descifra un blob AES-256-GCM (con AGCM_PREFIX).
 * @param {Buffer} blob
 * @param {Buffer} key
 * @returns {string|null}
 */
function aesDecrypt(blob, key) {
  try {
    const body = blob.slice(AGCM_PREFIX.length);
    const iv = body.slice(0, 12);
    const tag = body.slice(12, 28);
    const ct = body.slice(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (err) {
    console.warn('[device-cookies] AES decrypt failed:', err.message);
    return null;
  }
}

/** @returns {import('./host.js').SafeStorageLike|null} */
function getSafeStorage() {
  const ss = getHost().safeStorage;
  if (!ss) {
    if (!safeStorageWarned) {
      console.warn(
        '[device-cookies] sin safeStorage (headless) — cookies se guardan en ' +
        'plaintext con permisos 0600. Asegura un FS protegido en el servidor.'
      );
      safeStorageWarned = true;
    }
    return null;
  }
  try {
    if (ss.isEncryptionAvailable && ss.isEncryptionAvailable()) return ss;
  } catch {}
  if (!safeStorageWarned) {
    console.warn(
      '[device-cookies] safeStorage no disponible — cookies en plaintext. ' +
      'Asegura un keyring del OS (gnome-keyring, kwallet, Keychain, DPAPI).'
    );
    safeStorageWarned = true;
  }
  return null;
}

/**
 * Cifra una string de cookies y devuelve Buffer.
 * Orden de preferencia: safeStorage (Electron keyring) → AES-GCM
 * (RITMIQ_COOKIES_KEY, headless real) → plaintext 0600 (fallback).
 * @param {string} plain
 * @returns {Buffer}
 */
export function encryptCookies(plain) {
  if (!plain) return Buffer.alloc(0);
  const ss = getSafeStorage();
  if (ss) return ss.encryptString(plain);
  const key = getAesKey();
  if (key) return aesEncrypt(plain, key);
  // Fallback: marca "plain:" para distinguir en decrypt.
  return Buffer.concat([PLAIN_PREFIX, Buffer.from(plain, 'utf8')]);
}

/**
 * Descifra cookies (Buffer) a su contenido original. Detecta el esquema
 * por el prefijo del blob.
 * @param {Buffer|null|undefined} blob
 * @returns {string|null}
 */
export function decryptCookies(blob) {
  if (!blob || blob.length === 0) return null;
  // 1) Texto plano marcado.
  if (blob.length >= PLAIN_PREFIX.length &&
      blob.slice(0, PLAIN_PREFIX.length).equals(PLAIN_PREFIX)) {
    return blob.slice(PLAIN_PREFIX.length).toString('utf8');
  }
  // 2) AES-GCM (requiere la misma RITMIQ_COOKIES_KEY que al cifrar).
  if (blob.length >= AGCM_PREFIX.length &&
      blob.slice(0, AGCM_PREFIX.length).equals(AGCM_PREFIX)) {
    const key = getAesKey();
    if (!key) {
      console.warn('[device-cookies] blob AES pero falta RITMIQ_COOKIES_KEY');
      return null;
    }
    return aesDecrypt(blob, key);
  }
  // 3) blob binario de Electron safeStorage.
  const ss = getSafeStorage();
  if (ss) {
    try { return ss.decryptString(blob); }
    catch (err) {
      console.warn('[device-cookies] decrypt failed:', err.message);
      return null;
    }
  }
  // Sin esquema reconocible y sin safeStorage → no podemos descifrar.
  return null;
}

/**
 * Cache en memoria de paths ya escritos al disco para evitar I/O
 * repetidos. Invalida cuando `cookies_updated_at` cambia.
 * @type {Map<string, { path: string, updatedAt: string }>}
 */
const fileCache = new Map();

function cookiesDir() {
  return dataSubdir('device-cookies');
}

/**
 * Devuelve un path con las cookies del device en formato Netscape para
 * pasárselo a yt-dlp via --cookies. Si no hay cookies del device,
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
 * Detecta si las cookies de un device están caducadas examinando errores
 * típicos de yt-dlp. Solo se llama desde el wrapper cuando un download
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
