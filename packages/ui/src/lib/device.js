/**
 * Identidad del dispositivo (PWA) frente al desktop Ritmiq.
 *
 * - `device_id`: UUID estable, persistente en localStorage. Se genera la
 *   primera vez y nunca cambia (salvo que el user limpie storage). Lo
 *   usa el desktop como clave primaria en la tabla `devices`.
 * - `device_token`: secret emitido por el desktop al aprobar el pareo.
 *   Se incluye como `Authorization: Bearer <device_token>` en cada
 *   request al LAN server. NUNCA viaja a Supabase ni a terceros.
 * - `display_name`: nombre legible que el owner ve en su UI desktop.
 *
 * Migracion: si encontramos un access-token viejo en `ritmiq:lan:accessToken`
 * no lo borramos — la app puede seguir usandolo como fallback durante
 * la ventana de migracion (Fase 4 lo elimina).
 */

const DEVICE_ID_KEY    = 'ritmiq:device:id';
const DEVICE_TOKEN_KEY = 'ritmiq:device:token';
const DEVICE_NAME_KEY  = 'ritmiq:device:displayName';
const PAIRED_BASE_KEY  = 'ritmiq:device:pairedBaseUrl';

/** @returns {string} UUID v4 */
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback minimal RFC4122 v4.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

/** Obtiene (o genera) el device_id persistente. */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // sin localStorage (Safari modo incognito?) — id efimero.
    return uuid();
  }
}

/** @returns {string|null} */
export function getDeviceToken() {
  try { return localStorage.getItem(DEVICE_TOKEN_KEY); } catch { return null; }
}

/** @param {string|null} token */
export function setDeviceToken(token) {
  try {
    if (token) localStorage.setItem(DEVICE_TOKEN_KEY, token);
    else localStorage.removeItem(DEVICE_TOKEN_KEY);
  } catch {}
}

/** Nombre legible que la PWA reporta al desktop. */
export function getDisplayName() {
  try { return localStorage.getItem(DEVICE_NAME_KEY) || inferDisplayName(); }
  catch { return inferDisplayName(); }
}
export function setDisplayName(name) {
  try {
    if (name) localStorage.setItem(DEVICE_NAME_KEY, name);
    else localStorage.removeItem(DEVICE_NAME_KEY);
  } catch {}
}

/** Heuristica para sugerir nombre cuando el user no lo escribio. */
function inferDisplayName() {
  if (typeof navigator === 'undefined') return 'Dispositivo';
  const ua = navigator.userAgent || '';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Dispositivo';
}

/** Base URL del desktop con el que ya completamos pareo. */
export function getPairedBaseUrl() {
  try { return localStorage.getItem(PAIRED_BASE_KEY); } catch { return null; }
}
export function setPairedBaseUrl(url) {
  try {
    if (url) localStorage.setItem(PAIRED_BASE_KEY, url);
    else localStorage.removeItem(PAIRED_BASE_KEY);
  } catch {}
}

/** Borra token + paired base — equivalente a "desconectarme". */
export function clearDevicePairing() {
  setDeviceToken(null);
  setPairedBaseUrl(null);
}

/**
 * Genera un PIN de 4 digitos aleatorio para mostrar al owner del desktop
 * y compararlo con la solicitud que llega.
 */
export function generatePin() {
  const n = Math.floor(Math.random() * 10000);
  return String(n).padStart(4, '0');
}

/**
 * POST /pair contra el LAN server. Si la cuenta Supabase del user ya
 * tiene otro device aprobado, el endpoint auto-aprueba y devuelve el
 * token directamente. Si no, devuelve `pending` y la UI hace polling.
 *
 * @param {string} baseUrl
 * @param {Object} payload
 * @param {string} payload.deviceId
 * @param {string} payload.displayName
 * @param {string|null} payload.supabaseUserId
 * @param {string} payload.pin
 * @param {string|null} [payload.cookiesB64]
 * @returns {Promise<{ status: 'approved'|'pending', device_token?: string }>}
 */
export async function postPair(baseUrl, payload) {
  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: payload.deviceId,
      display_name: payload.displayName,
      supabase_user_id: payload.supabaseUserId ?? null,
      pin: payload.pin,
      cookies_b64: payload.cookiesB64 ?? null,
    }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error ?? `pair failed (${r.status})`);
  }
  return r.json();
}

/**
 * GET /pair/status?device_id=X — polling de la PWA mientras espera
 * aprobacion. Devuelve `approved`, `pending` o `rejected`.
 *
 * @param {string} baseUrl
 * @param {string} deviceId
 */
export async function getPairStatus(baseUrl, deviceId) {
  const r = await fetch(
    `${baseUrl.replace(/\/$/, '')}/pair/status?device_id=${encodeURIComponent(deviceId)}`,
    { cache: 'no-store' },
  );
  if (!r.ok) throw new Error(`status check failed (${r.status})`);
  return r.json();
}
