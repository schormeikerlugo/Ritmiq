/**
 * Cliente HTTP del servidor LAN de Electron.
 * Funciona desde desktop renderer (apuntando a 127.0.0.1:3939) y desde
 * la PWA en otro dispositivo (apuntando a la IP local del PC).
 *
 * El base URL se cachea en localStorage tras una verificación con /health.
 */

const STORAGE_KEY = 'ritmiq:lan:baseUrl';
const TUNNEL_KEY = 'ritmiq:lan:tunnelUrl';
const TOKEN_KEY  = 'ritmiq:lan:accessToken';
const HEALTH = '/health';

/** @returns {string|null} */
export function getLanBaseUrlSync() {
  try { return localStorage.getItem(STORAGE_KEY); }
  catch { return null; }
}

/** @param {string|null} url */
export function setLanBaseUrl(url) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** URL del tunnel Cloudflare (para acceso fuera de LAN). */
export function getTunnelUrlSync() {
  try { return localStorage.getItem(TUNNEL_KEY); } catch { return null; }
}

/** @param {string|null} url */
export function setTunnelUrl(url) {
  try {
    if (url) localStorage.setItem(TUNNEL_KEY, url);
    else localStorage.removeItem(TUNNEL_KEY);
  } catch {}
}

/** Token Bearer para autenticarse contra el LAN server. */
export function getAccessTokenSync() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

/** @param {string|null} token */
export function setAccessToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/**
 * Construye headers `Authorization: Bearer <token>` si hay token guardado.
 * Útil para llamadas vía `fetch()` (no para `<audio>` que no soporta headers).
 */
export function authHeaders() {
  const t = getAccessTokenSync();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Añade el token como query string a una URL. Necesario para que el
 * `<audio>` element pueda autenticarse (no permite headers custom).
 * @param {string} url
 */
export function withTokenInUrl(url) {
  const t = getAccessTokenSync();
  if (!t || !url) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(t)}`;
}

/**
 * Verifica que un base URL responde correctamente al endpoint /health.
 * @param {string} baseUrl
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function pingLan(baseUrl, timeoutMs = 1500) {
  if (!baseUrl) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // /health es público, no requiere token. Lo usamos como sanity check.
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${HEALTH}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.ok === true && data?.service === 'ritmiq';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Devuelve el primer base URL alcanzable en este orden:
 *   1. LAN local (rápido, mismas red)
 *   2. Cloudflare Tunnel (lento, funciona desde cualquier red)
 * @returns {Promise<string|null>}
 */
export async function getReachableLanBaseUrl() {
  const lan = getLanBaseUrlSync();
  if (lan && (await pingLan(lan))) return lan;
  const tunnel = getTunnelUrlSync();
  if (tunnel && (await pingLan(tunnel, 3000))) return tunnel;
  return null;
}

/**
 * Auto-detección al iniciar la PWA: si la app fue cargada desde una IP de
 * LAN (ej. http://192.168.68.114:5173) probamos automáticamente el mismo
 * host en puerto 3939 (donde corre el LAN server de Electron).
 *
 * Si responde, guardamos la URL para que streaming/búsqueda funcionen sin
 * configuración manual. No se ejecuta en localhost ni en HTTPS público.
 *
 * @returns {Promise<string|null>}
 */
export async function autoDetectLanFromHost() {
  if (typeof window === 'undefined') return null;
  const cached = getLanBaseUrlSync();
  if (cached && (await pingLan(cached))) return cached;

  const host = window.location.hostname;
  if (!host) return null;
  if (host === '127.0.0.1' || host === 'localhost') return null;

  const isPrivateIp = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host);
  const isMdns = host.endsWith('.local');
  if (!isPrivateIp && !isMdns) return null;

  const candidate = `${window.location.protocol}//${host}:3939`;
  if (await pingLan(candidate)) {
    setLanBaseUrl(candidate);
    return candidate;
  }
  return null;
}

/**
 * Resuelve el base URL preferido (LAN local sync) o nulo. Si necesitas el
 * que efectivamente responde con `pingLan`, usa `getReachableLanBaseUrl`.
 */
function preferredBase() {
  return getLanBaseUrlSync() || getTunnelUrlSync();
}

/**
 * Búsqueda de YouTube vía LAN o tunnel.
 * @param {string} query
 */
export async function lanSearch(query) {
  const base = preferredBase();
  if (!base) throw new Error('LAN/Tunnel no configurado');
  const r = await fetch(`${base}/yt/search?q=${encodeURIComponent(query)}`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`LAN search ${r.status}`);
  const j = await r.json();
  return j.items ?? [];
}

/**
 * Metadata de un video por URL/ID.
 * @param {string} idOrUrl
 */
export async function lanMetadata(idOrUrl) {
  const base = preferredBase();
  if (!base) throw new Error('LAN/Tunnel no configurado');
  const r = await fetch(`${base}/yt/metadata?q=${encodeURIComponent(idOrUrl)}`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`LAN metadata ${r.status}`);
  return r.json();
}

/**
 * URL del stream de un track con el token incluido (para `<audio>`).
 * @param {string} trackId
 * @returns {string|null}
 */
export function lanStreamUrl(trackId) {
  const base = preferredBase();
  if (!base) return null;
  return withTokenInUrl(`${base}/stream/${encodeURIComponent(trackId)}`);
}

/**
 * Pre-calienta el cache de stream URL.
 * @param {string} ytId
 */
export function prewarmStream(ytId) {
  const base = preferredBase();
  if (!base || !ytId) return;
  fetch(`${base}/yt/prewarm?q=${encodeURIComponent(ytId)}`, {
    headers: authHeaders(),
  }).catch(() => {});
}

/**
 * Obtiene los datos de una playlist pública de Spotify vía LAN/Tunnel.
 * @param {string} spotifyUrl
 */
export async function lanSpotifyPlaylist(spotifyUrl) {
  const base = preferredBase();
  if (!base) throw new Error('LAN/Tunnel no configurado');
  const r = await fetch(`${base}/spotify/playlist?url=${encodeURIComponent(spotifyUrl)}`, {
    headers: authHeaders(),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error ?? `LAN spotify ${r.status}`);
  }
  return r.json();
}
