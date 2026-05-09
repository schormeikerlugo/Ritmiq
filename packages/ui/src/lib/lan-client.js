/**
 * Cliente HTTP del servidor LAN de Electron.
 * Funciona desde desktop renderer (apuntando a 127.0.0.1:3939) y desde
 * la PWA en otro dispositivo (apuntando a la IP local del PC).
 *
 * El base URL se cachea en localStorage tras una verificación con /health.
 */

const STORAGE_KEY = 'ritmiq:lan:baseUrl';
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
 * Devuelve el LAN base URL actualmente alcanzable, o null.
 * Si hay uno cacheado y responde, lo usa.
 * @returns {Promise<string|null>}
 */
export async function getReachableLanBaseUrl() {
  const cached = getLanBaseUrlSync();
  if (cached && (await pingLan(cached))) return cached;
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
 * Búsqueda de YouTube vía LAN.
 * @param {string} query
 * @returns {Promise<Array<{id:string,title:string,uploader:string|null,duration:number|null,thumbnail:string|null}>>}
 */
export async function lanSearch(query) {
  const base = getLanBaseUrlSync();
  if (!base) throw new Error('LAN no configurado');
  const r = await fetch(`${base}/yt/search?q=${encodeURIComponent(query)}`);
  if (!r.ok) throw new Error(`LAN search ${r.status}`);
  const j = await r.json();
  return j.items ?? [];
}

/**
 * Metadata de un video por URL/ID vía LAN.
 * @param {string} idOrUrl
 */
export async function lanMetadata(idOrUrl) {
  const base = getLanBaseUrlSync();
  if (!base) throw new Error('LAN no configurado');
  const r = await fetch(`${base}/yt/metadata?q=${encodeURIComponent(idOrUrl)}`);
  if (!r.ok) throw new Error(`LAN metadata ${r.status}`);
  return r.json();
}

/**
 * URL del stream de un track persistido en biblioteca, servida por el LAN
 * server. Si está descargado, devuelve el archivo local; si no, redirige
 * al stream URL de yt-dlp.
 * @param {string} trackId
 * @returns {string|null}
 */
export function lanStreamUrl(trackId) {
  const base = getLanBaseUrlSync();
  if (!base) return null;
  return `${base}/stream/${encodeURIComponent(trackId)}`;
}

/**
 * Le pide al LAN server que pre-resuelva la URL de stream y la cachee.
 * Es fire-and-forget; no bloquea.
 *
 * @param {string} ytId
 */
export function prewarmStream(ytId) {
  const base = getLanBaseUrlSync();
  if (!base || !ytId) return;
  fetch(`${base}/yt/prewarm?q=${encodeURIComponent(ytId)}`).catch(() => {});
}

/**
 * Obtiene los datos de una playlist pública de Spotify vía LAN.
 * @param {string} spotifyUrl
 * @returns {Promise<{name:string, description:string|null, coverUrl:string|null, tracks:Array<{title:string,artist:string,durationMs:number}>}>}
 */
export async function lanSpotifyPlaylist(spotifyUrl) {
  const base = getLanBaseUrlSync();
  if (!base) throw new Error('LAN no configurado');
  const r = await fetch(`${base}/spotify/playlist?url=${encodeURIComponent(spotifyUrl)}`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error ?? `LAN spotify ${r.status}`);
  }
  return r.json();
}
