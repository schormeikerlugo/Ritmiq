/**
 * Identidad del dispositivo PWA (Modelo Y).
 *
 * Cada PWA tiene un `device_id` (UUID) persistente en localStorage y un
 * `device_token` (secret) que recibe del desktop tras el pareo. El token
 * va como Bearer en todas las requests al LAN server.
 *
 * `getEffectiveToken()` decide cual usar:
 *   1. device_token (si esta pareado).
 *   2. access_token del owner (si la PWA tiene el del propio desktop —
 *      caso uso interno).
 *
 * @module @ritmiq/ui/lib/device
 */

const DEVICE_ID_KEY = 'ritmiq:device:id';
const DEVICE_TOKEN_KEY = 'ritmiq:device:token';
const DEVICE_DISPLAY_NAME_KEY = 'ritmiq:device:displayName';

/** Genera o lee el device_id (UUID v4) persistido. */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `dev_${Math.random().toString(36).slice(2)}${Date.now()}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Lee el device_token actual (null si no esta pareado). */
export function getDeviceToken() {
  try { return localStorage.getItem(DEVICE_TOKEN_KEY); }
  catch { return null; }
}

/** Persiste el device_token devuelto por POST /pair (approved). */
export function setDeviceToken(token) {
  try {
    if (token) localStorage.setItem(DEVICE_TOKEN_KEY, token);
    else localStorage.removeItem(DEVICE_TOKEN_KEY);
  } catch {}
}

/** Display name visible para el owner. */
export function getDisplayName() {
  try {
    const stored = localStorage.getItem(DEVICE_DISPLAY_NAME_KEY);
    if (stored) return stored;
  } catch {}
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (ua.includes('iPhone')) return 'iPhone';
  if (ua.includes('iPad')) return 'iPad';
  if (ua.includes('Android')) return 'Android';
  return 'PWA navegador';
}

export function setDisplayName(name) {
  try { localStorage.setItem(DEVICE_DISPLAY_NAME_KEY, String(name)); } catch {}
}

/** Genera un PIN aleatorio de 4 digitos. */
export function generatePin() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

/**
 * POST /pair contra el desktop. Devuelve { status, deviceToken? }.
 * @param {string} baseUrl  Tunnel URL del desktop, sin slash final.
 * @param {{ pin: string, supabaseUserId?: string|null, cookiesB64?: string|null }} input
 */
export async function postPair(baseUrl, { pin, supabaseUserId = null, cookiesB64 = null }) {
  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: getDeviceId(),
      display_name: getDisplayName(),
      supabase_user_id: supabaseUserId,
      pin,
      cookies_b64: cookiesB64,
    }),
  });
  if (!r.ok) throw new Error(`/pair fallo ${r.status}`);
  return r.json();
}

/**
 * GET /pair/status?device_id=X. Devuelve { status, deviceToken? }.
 * @param {string} baseUrl
 */
export async function getPairStatusRemote(baseUrl) {
  const r = await fetch(
    `${baseUrl.replace(/\/$/, '')}/pair/status?device_id=${encodeURIComponent(getDeviceId() ?? '')}`
  );
  if (!r.ok) throw new Error(`/pair/status fallo ${r.status}`);
  return r.json();
}

/** Devuelve true si esta PWA ya tiene device_token aprobado. */
export function isPaired() {
  return Boolean(getDeviceToken());
}

function authFetch(baseUrl, path, init = {}) {
  const token = getDeviceToken();
  if (!token) throw new Error('Este dispositivo no está pareado con el servidor.');
  return fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
}

/**
 * Inicia el login de YouTube por navegador (Fase 3b). El servidor levanta un
 * contenedor noVNC y devuelve el puerto para abrir la pantalla remota.
 * @param {string} baseUrl
 * @returns {Promise<{ novncPort:number, status:string }>}
 */
export async function startYoutubeLink(baseUrl) {
  const r = await authFetch(baseUrl, '/youtube/link/start', { method: 'POST' });
  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    throw new Error(`No se pudo iniciar el login (${r.status})${msg ? `: ${msg}` : ''}`);
  }
  return r.json();
}

/**
 * Consulta el estado del login en curso.
 * @param {string} baseUrl
 * @returns {Promise<{ status:'idle'|'running'|'linked'|'expired'|'error', novncPort:number|null }>}
 */
export async function getYoutubeLinkStatus(baseUrl) {
  const r = await authFetch(baseUrl, '/youtube/link/status', { method: 'GET' });
  if (!r.ok) throw new Error(`status ${r.status}`);
  return r.json();
}

/**
 * Desvincula la cuenta de YouTube (borra cookies del device en el servidor).
 * @param {string} baseUrl
 */
export async function unlinkYoutube(baseUrl) {
  const r = await authFetch(baseUrl, '/youtube/unlink', { method: 'POST' });
  if (!r.ok) throw new Error(`unlink ${r.status}`);
  return r.json();
}

/**
 * Sube un archivo de cookies de YouTube (formato Netscape / cookies.txt) al
 * servidor, ligado a este device_token. El servidor las cifra y las usa
 * para resolver/descargar con la cuenta de YouTube del usuario (fallback a
 * las del dueño si no hay). Requiere estar pareado (device_token).
 *
 * @param {string} baseUrl  URL del servidor (LAN o túnel), sin slash final.
 * @param {string} cookiesText  Contenido del cookies.txt (Netscape).
 * @returns {Promise<{ ok: boolean }>}
 */
export async function uploadCookiesTxt(baseUrl, cookiesText) {
  const token = getDeviceToken();
  if (!token) throw new Error('Este dispositivo no está pareado con el servidor.');
  if (!cookiesText || !cookiesText.trim()) throw new Error('El archivo de cookies está vacío.');
  const cookies_b64 = btoa(unescape(encodeURIComponent(cookiesText)));
  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/cookies/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ cookies_b64 }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    throw new Error(`Subida falló (${r.status})${msg ? `: ${msg}` : ''}`);
  }
  return r.json();
}
