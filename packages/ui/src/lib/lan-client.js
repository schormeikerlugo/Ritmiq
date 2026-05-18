/**
 * Cliente HTTP del servidor LAN de Electron.
 * Funciona desde desktop renderer (apuntando a 127.0.0.1:3939) y desde
 * la PWA en otro dispositivo (apuntando a la IP local del PC).
 *
 * El base URL se cachea en localStorage tras una verificación con /health.
 */

import { supabase } from './supabase.js';

const STORAGE_KEY = 'ritmiq:lan:baseUrl';
const TUNNEL_KEY = 'ritmiq:lan:tunnelUrl';
const TOKEN_KEY  = 'ritmiq:lan:accessToken';
const HEALTH = '/health';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON = import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '';

/**
 * Cache de URLs firmadas por la Edge `sign-stream`. Las firmas tienen TTL
 * 5 min; mantenemos en cache `expiresAt - 30s` para no servir URLs que
 * podrían caducar mid-stream. Refresca solo cuando faltan <30s.
 *
 * @type {Map<string, { url: string, expiresAt: number }>}
 */
const signedCache = new Map();
const REFRESH_BUFFER_SEC = 30;

/**
 * Pide a la Edge Function `sign-stream` una URL firmada para `/stream/<trackId>`.
 * Centraliza autorización: Supabase valida el JWT y RLS verifica que el
 * track pertenezca al usuario. El LAN server solo valida la firma HMAC.
 *
 * Devuelve la URL completa lista para asignar a `<audio>.src`. Si la Edge
 * Function falla (Supabase caído, JWT caducado), devuelve null — el caller
 * debe manejar el error con UX apropiada.
 *
 * @param {string} trackId
 * @param {string} lanBaseUrl  Base URL del LAN server (LAN o Tunnel).
 * @returns {Promise<string|null>}
 */
export async function getSignedStreamUrl(trackId, lanBaseUrl) {
  if (!trackId || !lanBaseUrl) return null;

  // Cache hit (si queda margen razonable).
  const cached = signedCache.get(trackId);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - now > REFRESH_BUFFER_SEC) {
    return cached.url;
  }

  if (!SUPABASE_URL) {
    console.warn('[lan-client] sign-stream: VITE_SUPABASE_URL no configurado');
    return null;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    console.warn('[lan-client] sign-stream: sin sesión Supabase');
    return null;
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/sign-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON,
      },
      body: JSON.stringify({
        trackId,
        lanBaseUrl,
        lanBearer: getAccessTokenSync() ?? undefined,
      }),
    });
    if (!r.ok) {
      // 404: RLS bloqueó (track no es del user) o no existe.
      // 401: JWT inválido/caducado.
      console.warn(`[lan-client] sign-stream falló ${r.status} para ${trackId}`);
      return null;
    }
    const { url, expiresAt } = await r.json();
    signedCache.set(trackId, { url, expiresAt });
    return url;
  } catch (err) {
    console.warn('[lan-client] sign-stream error:', err?.message);
    return null;
  }
}

/** Limpia el cache de firmas (al cambiar de sesión). */
export function clearSignedStreamCache() {
  signedCache.clear();
}

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

/**
 * Token Bearer para autenticarse contra el LAN server.
 *
 * Modelo Y: PRIORIZA device_token (clave `ritmiq:device:token`, emitido
 * tras pareo). Solo cae al access_token legacy (clave `ritmiq:lan:accessToken`)
 * cuando NO hay device_token — tipico de PWAs pre-pareo o herramientas
 * internas que copian-pegan el access-token del owner.
 */
export function getAccessTokenSync() {
  try {
    const deviceToken = localStorage.getItem('ritmiq:device:token');
    if (deviceToken) return deviceToken;
    return localStorage.getItem(TOKEN_KEY);
  } catch { return null; }
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
 * Bulk-check de ytIds contra el cache `shared_audio` del desktop.
 * Devuelve un Set con los ytIds que estan en cache (reproducibles al
 * instante sin yt-dlp).
 *
 * Cache de sesion: cada ytId queda 60s para no spamear el endpoint en
 * busquedas repetidas (el user buscando "creep" cinco veces no genera
 * cinco round-trips). Cap a 100 ids por request (mismo cap server-side).
 *
 * Si no hay desktop alcanzable, devuelve Set vacio sin error.
 *
 * @param {string[]} ytIds
 * @returns {Promise<Set<string>>}
 */
const sharedCacheState = new Map(); // ytId -> { cached: boolean, at: number }
const SHARED_CACHE_TTL_MS = 60 * 1000;
export async function checkSharedCache(ytIds) {
  if (!Array.isArray(ytIds) || ytIds.length === 0) return new Set();
  const base = preferredBase();
  if (!base) return new Set();

  const now = Date.now();
  const known = new Set();
  const unknown = [];
  for (const id of ytIds) {
    if (!id) continue;
    const hit = sharedCacheState.get(id);
    if (hit && now - hit.at < SHARED_CACHE_TTL_MS) {
      if (hit.cached) known.add(id);
    } else {
      unknown.push(id);
    }
  }
  if (unknown.length === 0) return known;

  // Cap a 100 — coincide con el server-side cap. Si la PWA pidiera mas
  // (raro), tomamos los primeros 100 y descartamos el resto.
  const batch = unknown.slice(0, 100);
  try {
    const r = await fetch(
      `${base}/shared-cache/check?yt=${batch.map(encodeURIComponent).join(',')}`,
      { headers: authHeaders() }
    );
    if (!r.ok) return known;
    const body = await r.json();
    const cachedSet = new Set(body?.cached ?? []);
    // Persiste resultados (hits y misses) en el cache local de sesion.
    for (const id of batch) {
      const isCached = cachedSet.has(id);
      sharedCacheState.set(id, { cached: isCached, at: now });
      if (isCached) known.add(id);
    }
    return known;
  } catch {
    return known;
  }
}

// ─── CONTEXTO HISTÓRICO: fetchDirectStreamUrl ───────────────────────────
// Helper que pedía al lan-server la URL firmada directa de googlevideo
// para pasarla a `<audio>.src` y bypassear el proxy del Tunnel.
// Eliminado tras confirmar que googlevideo IP-locked rechaza la IP del
// iPhone con 403. El fallback al proxy duplica round-trips → peor latencia.
// Si en el futuro hay un mecanismo de re-firma de URL o se conecta por
// el mismo IP-mesh (Tailscale), reintroducir desde git history.
// ────────────────────────────────────────────────────────────────────────

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
