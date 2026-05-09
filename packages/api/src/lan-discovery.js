/**
 * LAN discovery desde el cliente (PWA o renderer Electron).
 *
 * Estrategia:
 *  1. Probar IPs guardadas en localStorage (último PC conocido).
 *  2. Si la PWA está en Electron, preguntar vía IPC al main process (que sí
 *     puede hacer mDNS browse).
 *  3. (Futuro) endpoint en Supabase Edge donde el Electron registra su IP local.
 *
 * @module @ritmiq/api/lan-discovery
 */

const STORAGE_KEY = 'ritmiq:lan:lastBaseUrl';
const HEALTH_PATH = '/health';

/**
 * @param {string} baseUrl
 * @param {number} timeoutMs
 */
async function ping(baseUrl, timeoutMs = 600) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${HEALTH_PATH}`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Devuelve la base URL del servidor LAN si hay alguno alcanzable, o null.
 * @param {Object} [opts]
 * @param {string[]} [opts.candidates] IPs/URLs a probar además de la guardada.
 * @returns {Promise<string|null>}
 */
export async function discoverLanServer(opts = {}) {
  const cached = localStorage.getItem(STORAGE_KEY);
  const tried = new Set();
  const list = [cached, ...(opts.candidates ?? [])].filter(Boolean);

  for (const base of list) {
    if (!base || tried.has(base)) continue;
    tried.add(base);
    if (await ping(base)) return base;
  }
  return null;
}

/** @param {string} baseUrl */
export function rememberLanServer(baseUrl) {
  localStorage.setItem(STORAGE_KEY, baseUrl);
}

export function forgetLanServer() {
  localStorage.removeItem(STORAGE_KEY);
}
