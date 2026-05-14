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
 * Pre-calienta el cache de stream URL. Dedupe en cliente: cada ytId se
 * prewarmea como máximo una vez por sesión (5 min) para no encolar yt-dlp
 * múltiples veces si el usuario toca el mismo resultado varias veces.
 * @param {string} ytId
 */
const prewarmedAt = new Map();
const PREWARM_DEDUP_MS = 5 * 60 * 1000;
export function prewarmStream(ytId) {
  const base = preferredBase();
  if (!base || !ytId) return;
  const now = Date.now();
  const last = prewarmedAt.get(ytId);
  if (last && now - last < PREWARM_DEDUP_MS) return;
  prewarmedAt.set(ytId, now);
  fetch(`${base}/yt/prewarm?q=${encodeURIComponent(ytId)}`, {
    headers: authHeaders(),
  }).catch(() => {});
}

/**
 * Resuelve la URL DIRECTA de googlevideo para un ytId vía LAN/Tunnel.
 * El cliente puede usarla como audio.src y las Range requests irán
 * directamente a googlevideo (sin pasar por Tunnel/proxy) — elimina la
 * latencia acumulada de muchos Range requests sobre Tunnel.
 *
 * Devuelve null si no hay LAN/Tunnel o si el server falla. El llamador
 * debe caer al endpoint /stream/yt:<id> como fallback.
 *
 * @param {string} ytId
 * @returns {Promise<string|null>}
 */
export async function fetchDirectStreamUrl(ytId) {
  const base = preferredBase();
  if (!base || !ytId) {
    console.info('[direct] sin base, skip', ytId);
    return null;
  }
  console.info('[direct] pidiendo URL directa para', ytId);
  try {
    const t0 = performance.now();
    const r = await fetch(`${base}/yt/streamurl?q=${encodeURIComponent(ytId)}`, {
      headers: authHeaders(),
    });
    const dt = Math.round(performance.now() - t0);
    if (!r.ok) {
      console.warn('[direct] server respondió', r.status, 'en', dt, 'ms');
      return null;
    }
    const j = await r.json();
    console.info('[direct] URL recibida en', dt, 'ms, host=', j?.url ? new URL(j.url).host : '?');
    return typeof j?.url === 'string' ? j.url : null;
  } catch (e) {
    console.warn('[direct] error de red:', e.message);
    return null;
  }
}

/**
 * Keep-alive del Cloudflare Tunnel para evitar el cold start (~1-3s) que
 * sufre el primer request cuando el túnel ha estado idle. Hace un ping a
 * /health cada 45s mientras la PWA esté abierta. Solo se activa cuando hay
 * Tunnel configurado (no LAN local, que no necesita keep-alive).
 *
 * @returns {() => void} función para detener el keep-alive.
 */
export function startTunnelKeepalive() {
  if (typeof window === 'undefined') return () => {};
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const tunnel = getTunnelUrlSync();
    // Solo si tunnel existe Y no estamos en LAN local (LAN ya es rápida).
    if (tunnel && !getLanBaseUrlSync()) {
      try {
        await fetch(`${tunnel.replace(/\/$/, '')}/health`, {
          headers: authHeaders(),
          cache: 'no-store',
        });
      } catch { /* ignorar — solo es keep-alive */ }
    }
  };
  // Primer ping inmediato para calentar el túnel al arrancar la PWA.
  tick();
  const id = setInterval(tick, 45_000);
  // También un ping al recuperar foco — iOS pausa timers en background.
  const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
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
