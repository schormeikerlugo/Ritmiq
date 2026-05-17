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
