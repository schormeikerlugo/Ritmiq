/**
 * Servidor HTTP local que sirve audio a otros dispositivos en la misma WiFi.
 * Anuncia el servicio vía mDNS como `_ritmiq._tcp.local`.
 *
 * Endpoints:
 *   GET /health                       → { ok: true, version }
 *   GET /stream/:trackId              → audio/* (file local o stream yt-dlp)
 *
 * @module main/lan-server
 */

import http from 'node:http';
import { Readable } from 'node:stream';
import { createReadStream, statSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Bonjour } from 'bonjour-service';
import { dataSubdir } from './host.js';
import { getStreamUrl, getMetadata, search, downloadAudio } from '@ritmiq/yt/ytdlp';
import { translateYtdlpError } from '@ritmiq/yt';
import {
  findSharedAudio, registerSharedAudio,
  sharedAudioStats, clearSharedAudio,
  findSharedAudioBulk,
} from '@ritmiq/db/sqlite';
import { getYtDlpPath } from './ytdlp-path.js';
import { detectCookiesBrowser, detectJsRuntime, exportCookiesToFile } from './cookies-detect.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  createPairRequest, approveDevice, rejectPairRequest,
  revokeDevice, renameDevice, getPairStatus,
  findDeviceByToken, listDevices, listPairRequests,
  logActivity, pruneOldActivity, updateDeviceCookies, clearDeviceCookies,
  getDeviceActivity,
  listDevicesForUser, listPairRequestsForUser, getDeviceOwnerUserId,
} from './devices.js';
import { getCookieFileForDevice, invalidateDeviceCookies, encryptCookies } from './device-cookies.js';
import {
  startLoginSession, getLoginStatus, stopLoginSession, isDockerAvailable,
} from './youtube-login.js';
import { createJwtVerifier } from './auth-jwt.js';

/**
 * Cache global de URLs (Fase 1): publica a Supabase Edge cada resolucion
 * exitosa de yt-dlp. Toggle via env var + override en runtime (IPC).
 * Cuando NO esta activo, todo funciona exactamente como antes — el cache
 * local sigue siendo el unico path de reuso.
 *
 * El override en runtime es necesario para que el toggle de Settings
 * UI surta efecto sin reiniciar la app. Se mantiene null hasta que el
 * renderer hace IPC con su valor; mientras tanto vale la env var.
 *
 * @type {boolean|null}
 */
let publishUrlCacheRuntime = null;

export function setPublishUrlCacheEnabled(enabled) {
  publishUrlCacheRuntime = !!enabled;
}

function publishUrlCacheEnabled() {
  if (publishUrlCacheRuntime !== null) return publishUrlCacheRuntime;
  // Default ON. Para desactivar via env: RITMIQ_PUBLISH_URL_CACHE=false
  const v = String(process.env.RITMIQ_PUBLISH_URL_CACHE ?? 'true').toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/**
 * Telemetria del cache global — solo en memoria, NO se persiste ni se
 * reporta a Supabase. Sirve para que la UI del toggle pueda mostrar
 * "X publicaciones hoy, ultima hace Y" y avisar si falta token.
 *
 * Antes este modulo era una caja negra; si el publish fallaba en
 * silencio (token vacio, 401, 500 transitorio) el usuario nunca se
 * enteraba. Con esto el toggle puede ser honesto sobre su estado.
 *
 * @type {{
 *   attempts: number,
 *   successes: number,
 *   failures: number,
 *   lastSuccessAt: number|null,
 *   lastError: { message: string, at: number }|null,
 *   skippedReason: 'no_token'|'no_url'|'toggle_off'|null,
 *   hasToken: boolean,
 *   hasUrl: boolean,
 * }}
 */
const publishStats = {
  attempts: 0,
  successes: 0,
  failures: 0,
  lastSuccessAt: null,
  lastError: null,
  skippedReason: null,
  hasToken: false,
  hasUrl: false,
};

/**
 * JWT del usuario autenticado, sincronizado desde el renderer via IPC
 * settings:setSupabaseToken cada vez que la sesion cambia.
 *
 * Necesario porque la Edge Function publish-stream-url valida con
 * auth.getUser() — exige JWT de USUARIO real, no acepta el ANON_KEY.
 * Antes el main intentaba publicar con ANON_KEY -> 401 invalid token.
 *
 * Null hasta que el renderer haga el primer push. El gate de publish
 * lo trata como skippedReason: 'no_session'.
 *
 * @type {string|null}
 */
let supabaseUserJwt = null;

/** Setter llamado desde IPC tras login/refresh/logout del renderer. */
export function setSupabaseUserJwt(token) {
  supabaseUserJwt = token && typeof token === 'string' ? token : null;
}

export function getPublishStats() {
  // Recalcula has* en cada llamada por si las envs se cargaron tarde.
  publishStats.hasUrl = !!(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL);
  publishStats.hasToken = !!supabaseUserJwt;
  return {
    ...publishStats,
    toggleEnabled: publishUrlCacheEnabled(),
    streamCacheSize: streamCacheRef?.size ?? 0,
    hasSession: !!supabaseUserJwt,
  };
}

/**
 * Referencia module-level al streamCache del LAN server, expuesta por
 * startLanServer al iniciar. Permite que getPublishStats reporte cuantas
 * URLs estan cacheadas en memoria, y que clearStreamCache permita al
 * usuario forzar invalidacion para probar la cadena yt-dlp -> publish
 * sin esperar 30min de TTL.
 *
 * @type {Map<string, any>|null}
 */
let streamCacheRef = null;

/**
 * Invalida todo el cache local de URLs resueltas. La siguiente vez que
 * se pida cualquier ytId disparara getStreamUrl (yt-dlp) y, si el toggle
 * esta ON, dispara publishToGlobalCache. Util para "ver el publish en
 * vivo" sin tener que reproducir canciones nuevas.
 *
 * @returns {number} cantidad de entradas eliminadas
 */
export function clearStreamCache() {
  if (!streamCacheRef) return 0;
  const n = streamCacheRef.size;
  streamCacheRef.clear();
  return n;
}

/**
 * API publica para que otras rutas (IPC yt:streamUrl, library:download,
 * etc.) puedan publicar URLs resueltas al cache global sin tener que
 * conocer el detalle del gate del toggle ni del TTL.
 *
 * Antes solo publishToGlobalCache se llamaba desde dentro del closure
 * de startLanServer (resolveCached -> hook tras getStreamUrl OK). El
 * problema: el IPC handler yt:streamUrl en ipc.js invoca getStreamUrl
 * directamente bypaseando ese hook -> tracks ephemeral (busqueda
 * fresca en desktop) nunca publicaban porque audio-source.js los
 * routea por resolveCloudStream -> api.ytStreamUrl -> IPC, no por LAN.
 *
 * Esta funcion expone el hook a esos call sites para que el publish
 * ocurra independientemente de la ruta de entrada a yt-dlp.
 *
 * @param {string} ytId
 * @param {string} url     URL fresca de googlevideo recien resuelta
 * @param {number} [ttlMs] TTL del cache local (default 30min). Sirve
 *                         para calcular expires_at coherente con el
 *                         cache de memoria del LAN server.
 */
export function publishResolvedUrl(ytId, url, ttlMs = 30 * 60 * 1000) {
  if (!publishUrlCacheEnabled()) {
    if (!publishStats.skippedReason) publishStats.skippedReason = 'toggle_off';
    return;
  }
  if (!ytId || !url) return;
  const expiresAt = Date.now() + ttlMs;
  // Fire-and-forget: no esperamos, no propagamos. publishToGlobalCache
  // ya wrap-ea con try/catch interno y actualiza publishStats.
  publishToGlobalCache(ytId, url, expiresAt).catch((err) => {
    console.warn(`[lan-server] publishResolvedUrl fallo (no fatal): ${err?.message ?? err}`);
  });
}

/**
 * Publica metadata del track al diccionario global tracks_global.
 * Llamado tras download exitoso en library:download IPC.
 *
 * Usa el JWT del usuario logueado (supabaseUserJwt) — la Edge
 * publish-track-meta lo exige (auth.getUser). Sin sesion, no publica.
 *
 * Fire-and-forget. Dedupe in-memory en metaPublishedYtIds (cada
 * arranque del main process empieza vacio — la Edge ya wrap-ea con
 * UPSERT idempotente asi que duplicados de boots distintos no hacen
 * dano).
 *
 * @param {{ytId: string, title: string, artist?: string, album?: string,
 *          coverUrl?: string, durationSeconds?: number}} meta
 */
const metaPublishedYtIds = new Set();
export async function publishTrackMetaFromMain(meta) {
  if (!meta?.ytId || !meta.title) return;
  if (metaPublishedYtIds.has(meta.ytId)) return;
  metaPublishedYtIds.add(meta.ytId);

  const SUP = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  const JWT = supabaseUserJwt;
  if (!SUP || !ANON || !JWT) {
    // Sin alguno de estos no podemos publicar — quitamos del set para
    // que el siguiente download intente de nuevo cuando si se tenga.
    metaPublishedYtIds.delete(meta.ytId);
    return;
  }

  try {
    const res = await fetch(`${SUP}/functions/v1/publish-track-meta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${JWT}`,
        apikey: ANON,
      },
      body: JSON.stringify({
        ytId: meta.ytId,
        title: meta.title,
        artist: meta.artist ?? 'Desconocido',
        album: meta.album ?? null,
        coverUrl: meta.coverUrl ?? null,
        durationSeconds: typeof meta.durationSeconds === 'number'
          ? meta.durationSeconds
          : null,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
    }
  } catch (err) {
    console.warn(`[lan-server] publishTrackMetaFromMain fallo (no fatal): ${err?.message ?? err}`);
    metaPublishedYtIds.delete(meta.ytId);
  }
}

/**
 * Publica una URL resuelta al cache global de Supabase.
 * Fire-and-forget: nunca propaga errores al caller.
 *
 * AUTENTICACION:
 *   Edge Function publish-stream-url valida con `userClient.auth.getUser()`,
 *   que solo acepta un JWT de USUARIO real autenticado contra Supabase Auth.
 *   El ANON_KEY del proyecto NO sirve: la function lo rechaza con 401
 *   "invalid token" (verificado live).
 *
 *   Por eso usamos `supabaseUserJwt`, sincronizado desde el renderer via
 *   IPC settings:setSupabaseToken cada vez que la sesion cambia (login,
 *   refresh automatico, logout). El header apikey lleva el ANON_KEY del
 *   proyecto (necesario para que el reverse proxy de Supabase Functions
 *   identifique el proyecto) y Authorization lleva el JWT del usuario.
 *
 *   Si no hay sesion, publishStats.skippedReason = 'no_session'.
 *
 * @param {string} ytId
 * @param {string} url
 * @param {number} expiresAtMs  Timestamp (Date.now() + TTL)
 */
async function publishToGlobalCache(ytId, url, expiresAtMs) {
  const SUP = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const ANON = process.env.VITE_SUPABASE_ANON_KEY
    ?? process.env.SUPABASE_ANON_KEY
    ?? '';
  const USER_JWT = supabaseUserJwt;
  if (!SUP) { publishStats.skippedReason = 'no_url'; return; }
  if (!ANON) { publishStats.skippedReason = 'no_apikey'; return; }
  if (!USER_JWT) { publishStats.skippedReason = 'no_session'; return; }
  if (!ytId || !url || !expiresAtMs) return;

  publishStats.attempts++;
  publishStats.skippedReason = null;

  try {
    const expiresAt = new Date(expiresAtMs).toISOString();
    const res = await fetch(`${SUP}/functions/v1/publish-stream-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Authorization: JWT del usuario logueado (Edge lo valida con
        // auth.getUser para asociar el publish a un user real).
        Authorization: `Bearer ${USER_JWT}`,
        // apikey: el ANON_KEY del proyecto, necesario para que el gateway
        // de Supabase Functions identifique el proyecto antes de rutear
        // a la Edge. Sin esto, el proxy devuelve 401 antes incluso de
        // ejecutar el codigo de la function.
        apikey: ANON,
      },
      body: JSON.stringify({
        ytId,
        url,
        contentType: 'audio/mp4',
        expiresAt,
        source: 'desktop',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
    }
    publishStats.successes++;
    publishStats.lastSuccessAt = Date.now();
  } catch (err) {
    publishStats.failures++;
    publishStats.lastError = {
      message: String(err?.message ?? err).slice(0, 200),
      at: Date.now(),
    };
    // Re-throw para que el .catch() del caller registre en consola.
    throw err;
  }
}

/**
 * Orígenes permitidos para CORS. Se refleja el `Origin` del request si
 * coincide; si no, se cae a '*'. Modo permisivo aceptable porque
 * los endpoints sensibles requieren Bearer token.
 */
const ALLOWED_ORIGINS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
  /^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,
  /^https:\/\/.*\.vercel\.app$/,
  /^https:\/\/.*\.cfargotunnel\.com$/,
  /^https:\/\/.*\.trycloudflare\.com$/,
];

/**
 * @param {Object} opts
 * @param {number} opts.port
 * @param {import('better-sqlite3').Database} opts.db
 * @param {string} [opts.accessToken]  Token Bearer requerido para todas las
 *   rutas excepto /health. Si no se pasa, el server queda abierto.
 * @param {string} [opts.supabaseUrl]  Base URL del proyecto Supabase, para
 *   verificar JWT de usuarios vía JWKS. Default: env VITE_SUPABASE_URL.
 * @param {string} [opts.supabaseJwtSecret] Secreto HS256 legacy (opcional).
 * @param {boolean} [opts.requireAuthForPair] Exigir JWT válido en /pair.
 */
export async function startLanServer({
  port,
  db,
  accessToken,
  supabaseUrl,
  supabaseJwtSecret,
  requireAuthForPair,
}) {
  const ytBinary = getYtDlpPath();
  const cookiesFromBrowser = detectCookiesBrowser();
  const jsRuntime = detectJsRuntime();
  // Secret compartido con la Edge Function `sign-stream`. Sin esto el LAN
  // server no puede validar firmas y rechaza requests `/stream/` salvo
  // que ACCEPT_UNSIGNED esté activo (modo de compatibilidad temporal).
  const STREAM_SIGNING_SECRET = process.env.RITMIQ_STREAM_SIGNING_SECRET ?? null;
  const ACCEPT_UNSIGNED =
    String(process.env.RITMIQ_ACCEPT_UNSIGNED_STREAMS ?? '').toLowerCase() === 'true';
  if (!STREAM_SIGNING_SECRET) {
    console.warn('[lan-server] sin RITMIQ_STREAM_SIGNING_SECRET — firmas DESHABILITADAS');
  }
  if (ACCEPT_UNSIGNED) {
    console.warn('[lan-server] ACCEPT_UNSIGNED activo — se aceptan requests sin firma (modo compat)');
  }
  // Allowlist de cuentas Supabase de confianza (Fase 3c). Auto-aprueba el
  // pareo sin PIN. Formato: lista separada por comas de user_id (o email).
  const ALLOWED_USERS = new Set(
    String(process.env.RITMIQ_ALLOWED_USERS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  if (ALLOWED_USERS.size > 0) {
    console.log(`[lan-server] allowlist activa (${ALLOWED_USERS.size} cuentas auto-aprobadas)`);
  }
  // ── Verificación de identidad Supabase (JWT) ───────────────────────
  // Permite confiar en el supabase_user_id de un cliente (viene del `sub`
  // de un token firmado por Supabase), en vez de aceptarlo autodeclarado.
  // Es la base del modelo de administración por cuenta (sub-admin).
  const supaUrl = supabaseUrl || process.env.VITE_SUPABASE_URL || '';
  const jwtSecret = supabaseJwtSecret || process.env.RITMIQ_SUPABASE_JWT_SECRET || null;
  const jwtVerifier = createJwtVerifier({
    supabaseUrl: supaUrl || undefined,
    hs256Secret: jwtSecret || undefined,
  });
  // Exigir login para parear. Por defecto ON cuando hay verificación
  // configurada; se puede forzar OFF con RITMIQ_REQUIRE_AUTH_FOR_PAIR=false.
  const REQUIRE_AUTH_FOR_PAIR =
    requireAuthForPair ??
    (String(process.env.RITMIQ_REQUIRE_AUTH_FOR_PAIR ?? '').toLowerCase() === 'false'
      ? false
      : jwtVerifier.isConfigured());
  if (jwtVerifier.isConfigured()) {
    console.log(
      `[lan-server] verificación JWT Supabase activa${REQUIRE_AUTH_FOR_PAIR ? ' (login requerido para parear)' : ''}`
    );
  } else {
    console.warn(
      '[lan-server] SIN verificación JWT (configura VITE_SUPABASE_URL) — supabase_user_id NO es confiable'
    );
  }
  // Cache persistente para yt-dlp (player.js, JS solvers, etc.). Sin esto
  // el AppImage monta en /tmp distinto cada arranque → yt-dlp re-descarga
  // 3-5MB de player.js cada vez. Pinneamos en userData.
  const cacheDir = dataSubdir('yt-dlp-cache');
  console.log(
    cookiesFromBrowser
      ? `[lan-server] yt-dlp cookies: ${cookiesFromBrowser} (override RITMIQ_YTDLP_COOKIES_BROWSER)`
      : '[lan-server] yt-dlp sin cookies — instala Firefox/Chrome y loguéate a YouTube'
  );
  console.log(
    jsRuntime
      ? `[lan-server] yt-dlp js-runtime: ${jsRuntime} (override RITMIQ_YTDLP_JS_RUNTIME)`
      : '[lan-server] yt-dlp SIN runtime JS — algunos vídeos sólo darán storyboards. ' +
        'Instala Deno (sudo pacman -S deno) o Node (sudo pacman -S nodejs) para reproducción fiable'
  );
  // `ytOpts` se mutará una vez `cookiesFile` esté listo (async). Mientras
  // tanto las primeras llamadas usan `cookiesFromBrowser` (más lento pero
  // funcional). El refresh periódico mantiene el archivo fresco para que
  // YouTube no rote las cookies.
  // Archivo de cookies Netscape explícito (headless/Docker, sin navegador).
  // Tiene prioridad sobre --cookies-from-browser. Se monta como volumen.
  const cookiesFileEnv = process.env.RITMIQ_YTDLP_COOKIES_FILE || undefined;
  if (cookiesFileEnv) {
    console.log(`[lan-server] yt-dlp cookies file (env): ${cookiesFileEnv}`);
  }

  const ytOpts = {
    binary: ytBinary,
    cookiesFromBrowser: cookiesFileEnv ? undefined : (cookiesFromBrowser ?? undefined),
    cookiesFile: cookiesFileEnv,
    jsRuntime: jsRuntime ?? undefined,
    cacheDir,
    // m4a/AAC obligatorio: el LAN server sirve también al PWA (iOS Safari)
    // que NO decodifica opus/webm. Síntoma característico: la barra avanza
    // pero NO se escucha audio. Selector cae a `bestaudio` puro si m4a no
    // está disponible para ese vídeo concreto. Electron/Chromium reproduce
    // m4a sin problema, así que lo dejamos global.
    preferM4a: true,
  };
  if (cookiesFromBrowser && !cookiesFileEnv) {
    // Background — no bloquear el arranque del LAN server. Cuando termine,
    // mutamos `ytOpts` para que los próximos plays vayan por la vía rápida.
    const t0 = Date.now();
    exportCookiesToFile(ytBinary, cookiesFromBrowser).then((file) => {
      if (file) {
        ytOpts.cookiesFile = file;
        console.log(`[lan-server] cookies file cacheado en ${file} (${Date.now() - t0}ms) — los próximos plays serán más rápidos`);
      }
    });
    // Refresh periódico cada 50 min (TTL pragmático: YouTube suele rotar
    // cookies cada ~1h; nos adelantamos un poco).
    setInterval(() => {
      exportCookiesToFile(ytBinary, cookiesFromBrowser, 0).then((file) => {
        if (file) {
          ytOpts.cookiesFile = file;
          console.log('[lan-server] cookies file refrescado');
        }
      });
    }, 50 * 60 * 1000).unref();
  }

  /**
   * Verifica si el request está autenticado. Acepta:
   *  - Header `Authorization: Bearer <token>`
   *  - Query string `?token=<token>`
   *  Útil porque <audio> no permite headers custom.
   */
  function isAuthorized(req, url) {
    if (!accessToken) return true; // server abierto si no hay token
    const auth = req.headers['authorization'];
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      const t = auth.slice(7).trim();
      if (t === accessToken) return true;
    }
    const qsToken = url.searchParams.get('token');
    if (qsToken && qsToken === accessToken) return true;
    return false;
  }

  // ── Modelo Y: device_token auth ────────────────────────────────────
  /** Extrae el Bearer token (o ?token=) del request. */
  function extractBearer(req, url) {
    const auth = req.headers['authorization'];
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    const qsToken = url.searchParams.get('token');
    return qsToken || null;
  }

  /** Owner-only auth. */
  function isOwner(req, url) {
    if (!accessToken) return true;
    return extractBearer(req, url) === accessToken;
  }

  /**
   * Device-or-owner auth. Devuelve sentinel { owner: true } o DeviceRow.
   * @returns {{ owner: true } | import('./devices.js').DeviceRow | null}
   */
  function authorizeDeviceOrOwner(req, url) {
    const token = extractBearer(req, url);
    if (!token) return null;
    if (accessToken && token === accessToken) return { owner: true };
    const dev = findDeviceByToken(db, token);
    return dev ?? null;
  }

  /**
   * Autorización para administración por cuenta. Resuelve la identidad del
   * request en tres niveles y devuelve un principal admin:
   *   - owner (access-token)        → { owner:true }                (gestiona todo)
   *   - device_token válido         → { deviceId, userId }          (gestiona lo suyo)
   *   - JWT Supabase válido         → { userId }                    (gestiona lo suyo)
   * Devuelve null si no autoriza.
   * @returns {Promise<{owner:true}|{userId:string,deviceId?:string}|null>}
   */
  async function authorizeAdmin(req, url) {
    const token = extractBearer(req, url);
    if (!token) return null;
    if (accessToken && token === accessToken) return { owner: true };
    // device_token: identidad del propio dispositivo pareado.
    const dev = findDeviceByToken(db, token);
    if (dev) {
      return { userId: dev.supabase_user_id ?? null, deviceId: dev.device_id };
    }
    // JWT de Supabase: identidad de una cuenta (aún sin device concreto).
    if (jwtVerifier.isConfigured()) {
      const verified = await jwtVerifier.verify(token);
      if (verified) return { userId: verified.userId };
    }
    return null;
  }

  /**
   * Devuelve opciones de yt-dlp para un request. Si el caller autorizo
   * con device_token y el device tiene cookies subidas, las usamos. Si
   * no, fallback a las cookies del owner (Firefox export).
   */
  function ytOptsFor(principal) {
    if (principal && principal.owner !== true) {
      try {
        const file = getCookieFileForDevice(principal);
        if (file) return { ...ytOpts, cookiesFile: file, cookiesFromBrowser: undefined };
      } catch (e) {
        console.warn('[lan-server] device cookies failed, fallback to owner:', e?.message ?? e);
      }
    }
    return ytOpts;
  }

  // ── Rate limit en pareo (5/min/IP) ─────────────────────────────────
  /** @type {Map<string, number[]>} */
  const pairRateMap = new Map();
  const PAIR_RATE_WINDOW_MS = 60 * 1000;
  const PAIR_RATE_MAX = 5;
  function pairRateLimit(ip) {
    if (!ip) return true;
    const now = Date.now();
    const arr = (pairRateMap.get(ip) ?? []).filter((t) => now - t < PAIR_RATE_WINDOW_MS);
    if (arr.length >= PAIR_RATE_MAX) return false;
    arr.push(now);
    pairRateMap.set(ip, arr);
    return true;
  }

  // ── Listeners para que el renderer del desktop reciba pair requests
  /** @type {Set<(req: { deviceId:string, displayName:string, pin:string }) => void>} */
  const pairListeners = new Set();
  function notifyOwnerNewPairRequest(payload) {
    for (const cb of pairListeners) { try { cb(payload); } catch {} }
  }
  function onPairRequest(cb) {
    pairListeners.add(cb);
    return () => pairListeners.delete(cb);
  }

  // Activity log rotation: prune al arrancar + cada 12h.
  try { pruneOldActivity(db, 5); } catch {}
  setInterval(() => {
    try { pruneOldActivity(db, 5); } catch {}
  }, 12 * 3600 * 1000).unref();

  // Cache compartido: directorio donde guardamos los m4a descargados a
  // demanda desde el endpoint /download. Distinto de userData/audio (que
  // es para descargas explícitas del usuario propietario del desktop):
  // estos archivos los puede consumir cualquier cuenta autorizada por
  // Supabase RLS vía firma HMAC. Persisten hasta que el user limpie con
  // el botón "Limpiar caché compartido" en Ajustes.
  const sharedAudioDir = dataSubdir('shared-audio');
  try { mkdirSync(sharedAudioDir, { recursive: true }); } catch {}

  /**
   * Coalescing de descargas: si llegan dos requests al mismo ytId, ambos
   * esperan al mismo yt-dlp. Sin esto descargaríamos N veces el mismo
   * archivo si varios clientes le dan play casi a la vez.
   * @type {Map<string, Promise<string>>}
   */
  const inflightDownloads = new Map();

  /**
   * Descarga el audio (m4a) a `sharedAudioDir`, registra en SQLite, y
   * devuelve la ruta absoluta. Si ya estaba en cache la devuelve directo.
   *
   * @param {string} ytId
   * @param {object} dlOpts  Heredados del ytOpts del LAN (cookies, runtime).
   * @returns {Promise<string>}
   */
  async function downloadSharedAudio(ytId, dlOpts) {
    const existing = findSharedAudio(db, ytId);
    if (existing) return existing.filePath;

    const inflight = inflightDownloads.get(ytId);
    if (inflight) return inflight;

    const promise = (async () => {
      const outBase = join(sharedAudioDir, ytId);
      const t0 = Date.now();
      console.log(`[lan-server] download ${ytId} START`);
      await downloadAudio(ytId, outBase, {
        ...dlOpts,
        // m4a obligatorio: la PWA en iOS Safari no decodifica opus/webm.
        // El mismo archivo se sirve después al elemento <audio> sin
        // conversión, así que tiene que ser un contenedor compatible.
        format: 'm4a',
      });
      const finalPath = `${outBase}.m4a`;
      let size = 0;
      try { size = statSync(finalPath).size; } catch {}
      registerSharedAudio(db, {
        ytId, filePath: finalPath, mime: 'audio/mp4', size,
      });
      console.log(`[lan-server] download ${ytId} OK en ${Date.now() - t0}ms (${size} bytes)`);
      return finalPath;
    })().finally(() => {
      inflightDownloads.delete(ytId);
    });

    inflightDownloads.set(ytId, promise);
    return promise;
  }

  // Cache en memoria de URLs de stream resueltas por yt-dlp.
  // Las URLs de googlevideo expiran a las ~6h; cacheamos 30 minutos para
  // estar muy holgados. Resolver yt-dlp tarda 1-3s (con ios player_client),
  // esto evita la espera en reproducciones repetidas / pre-resolves.
  /** @type {Map<string, { url: string, expiresAt: number, inflight?: Promise<string> }>} */
  const streamCache = new Map();
  // Expone el cache al module-level para que getPublishStats reporte
  // tamano y clearStreamCache pueda invalidarlo via IPC desde Settings.
  streamCacheRef = streamCache;
  const TTL_MS = 30 * 60 * 1000;

  /**
   * Cola con concurrencia limitada para yt-dlp. CPU contention con muchos
   * procesos simultáneos hace que un único yt-dlp pase de 2.8s a 7+s.
   * Subimos a 3 (antes 2): con `cookiesFile` cacheado yt-dlp es más ligero
   * y permite procesar prewarms en paralelo al click sin contención. Damos
   * prioridad a streams reales sobre prewarms.
   */
  const MAX_CONCURRENT = 3;
  let running = 0;
  /** @type {Array<any>} jobs en cola esperando slot. */
  const waitQueue = [];
  /** @type {Set<any>} jobs actualmente corriendo (con yt-dlp activo). */
  const runningJobs = new Set();

  function scheduleNext() {
    if (running >= MAX_CONCURRENT) return;
    if (waitQueue.length === 0) return;
    // Orden descendente por prioridad — saca el de mayor prioridad.
    waitQueue.sort((a, b) => b.priority - a.priority);
    const job = waitQueue.shift();
    running++;
    runningJobs.add(job);
    job.run();
  }

  /**
   * Mata yt-dlp procesos corriendo con prioridad < umbral. El cache se
   * limpia para que un futuro request los vuelva a resolver. Solo se usa
   * cuando llega un click p=10 y aún hay prewarms ocupando los 2 slots.
   */
  function killLowPriorityRunning(threshold) {
    let killed = 0;
    for (const job of runningJobs) {
      if (job.priority < threshold) {
        try { job.childPromise?.kill?.(); } catch {}
        streamCache.delete(job.ytId);
        killed++;
      }
    }
    if (killed > 0) {
      console.log(`[lan-server] killed ${killed} low-prio running (umbral=${threshold})`);
    }
  }

  /**
   * Cuando llega un job de alta prioridad (stream real del usuario),
   * descartamos de la cola los de baja prioridad (auto-prewarm de search)
   * que aún no han empezado. El click es lo único que importa ahora; los
   * prewarms eran apuestas y ya perdieron.
   */
  function evictLowPriorityQueued(threshold) {
    const before = waitQueue.length;
    for (let i = waitQueue.length - 1; i >= 0; i--) {
      const j = waitQueue[i];
      if (j.priority < threshold) {
        waitQueue.splice(i, 1);
        // Marcar el inflight como cancelado limpiando el cache para que un
        // futuro request lo vuelva a intentar.
        streamCache.delete(j.ytId);
        // Resolver el promise con error para que cualquier await termine.
        j.cancel?.();
      }
    }
    const evicted = before - waitQueue.length;
    if (evicted > 0) {
      console.log(`[lan-server] evicted ${evicted} low-prio jobs (umbral=${threshold})`);
    }
  }

  /**
   * @param {string} ytId
   * @param {number} priority  10 = stream del usuario, 1 = prewarm background
   */
  function resolveCached(ytId, priority = 1, dlOpts = null) {
    const now = Date.now();
    const hit = streamCache.get(ytId);
    if (hit) {
      if (hit.url && hit.expiresAt > now) {
        console.log(`[lan-server] resolve ${ytId} CACHE HIT`);
        return Promise.resolve(hit.url);
      }
      if (hit.inflight) {
        console.log(`[lan-server] resolve ${ytId} INFLIGHT (esperando, p=${priority})`);
        // Si la prioridad subió (de prewarm a stream real), promover en cola
        // si aún no empezó.
        const queued = waitQueue.find((j) => j.ytId === ytId);
        if (queued && priority > queued.priority) queued.priority = priority;
        // FIX BUG 1: también promover prioridad en runningJobs. Sin esto,
        // killLowPriorityRunning(7) mataba el job del CLICK porque seguia
        // con p=5 (prewarm) en runningJobs, mientras waitQueue tenia p=10.
        // Resultado: HTTP 500 "cancelled" y reintento desde cero.
        for (const job of runningJobs) {
          if (job.ytId === ytId && priority > job.priority) {
            job.priority = priority;
          }
        }
        // CRÍTICO: si la promoción es a alta prioridad, también purgar la
        // cola y matar yt-dlp running de baja prio. Antes faltaba esto y el
        // click esperaba a que terminaran los prewarms corriendo.
        if (priority >= 7) {
          evictLowPriorityQueued(7);
          killLowPriorityRunning(7);
          // Si el job promovido estaba queued (no corriendo), darle slot ya.
          scheduleNext();
        }
        return hit.inflight;
      }
    }
    // Si entra un job de alta prioridad (click real del usuario),
    // limpiar la cola Y matar yt-dlp en ejecución de baja prio. Los
    // prewarms ya no importan; el click es lo único que importa.
    if (priority >= 7) {
      evictLowPriorityQueued(7);
      killLowPriorityRunning(7);
    }

    // Crear promise pendiente — encolar el yt-dlp respetando concurrencia.
    let resolveFn, rejectFn;
    const p = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
    streamCache.set(ytId, { url: '', expiresAt: 0, inflight: p });

    const job = {
      ytId,
      priority,
      childPromise: null,   // promise de getStreamUrl (con .kill())
      cancel: () => rejectFn(new Error('cancelled (low priority evicted)')),
      run: async () => {
        const t0 = Date.now();
        console.log(`[lan-server] resolve ${ytId} START (p=${job.priority})`);
        try {
          // Cache-miss: resolver con las cookies del solicitante si se pasaron
          // (dlOpts, p.ej. las de un device con cuenta propia); si no, las del
          // owner. El resultado se cachea por ytId (caché global compartido):
          // el primero que resuelve fija la URL para todos, que es el
          // comportamiento deseado del caché compartido en el servidor.
          const cp = getStreamUrl(ytId, dlOpts || ytOpts);
          job.childPromise = cp;
          const url = await cp;
          const dt = Date.now() - t0;
          console.log(`[lan-server] resolve ${ytId} OK en ${dt}ms`);
          const expiresAt = Date.now() + TTL_MS;
          streamCache.set(ytId, { url, expiresAt });
          resolveFn(url);
          // FASE 1 CACHE GLOBAL: publicar al cache de Supabase para que
          // otros users sin LAN propio puedan reutilizar esta URL.
          // Fire-and-forget — si falla por red o auth, NO bloquea el
          // flujo local. Toggle via RITMIQ_PUBLISH_URL_CACHE env var.
          if (publishUrlCacheEnabled()) {
            publishToGlobalCache(ytId, url, expiresAt).catch((err) => {
              console.warn(`[lan-server] publish stream-url fallo (no fatal): ${err?.message ?? err}`);
            });
          } else {
            // Solo registrar el motivo si NO hay otro motivo de skip ya
            // anotado (no_token / no_url ganan en prioridad informativa).
            if (!publishStats.skippedReason) publishStats.skippedReason = 'toggle_off';
          }
        } catch (err) {
          console.warn(`[lan-server] resolve ${ytId} FAIL`, err.message);
          streamCache.delete(ytId);
          rejectFn(err);
        } finally {
          running--;
          runningJobs.delete(job);
          scheduleNext();
        }
      },
    };
    waitQueue.push(job);
    if (waitQueue.length > 1 || running >= MAX_CONCURRENT) {
      console.log(`[lan-server] resolve ${ytId} QUEUED (cola=${waitQueue.length}, running=${running})`);
    }
    scheduleNext();
    return p;
  }

  /**
   * Valida una firma HMAC emitida por la Edge Function `sign-stream`.
   * Centraliza autorización en Supabase: si Supabase aceptó al usuario
   * para este trackId (vía RLS), nos firmó la URL → reproducimos.
   *
   * Payload firmado: `${trackId}|${ytId}|${exp}`
   * Validez: 5 min (TTL en la Edge), permite Range requests largos sin
   *   re-firmar. Si caduca mid-stream, el siguiente Range falla y la PWA
   *   pedirá nueva firma.
   *
   * @param {string} trackId
   * @param {URLSearchParams} qs
   * @returns {{ ok: true, ytId: string|null } | { ok: false, reason: string }}
   */
  function validateStreamSignature(trackId, qs) {
    const sig = qs.get('sig');
    const exp = qs.get('exp');
    const yt  = qs.get('yt') ?? '';
    if (!sig || !exp) return { ok: false, reason: 'missing sig/exp' };

    const expN = parseInt(exp, 10);
    if (!Number.isFinite(expN)) return { ok: false, reason: 'bad exp' };
    if (Date.now() / 1000 > expN) return { ok: false, reason: 'expired' };

    if (!STREAM_SIGNING_SECRET) {
      return { ok: false, reason: 'server not configured' };
    }
    const payload = `${trackId}|${yt}|${expN}`;
    const expected = createHmac('sha256', STREAM_SIGNING_SECRET)
      .update(payload).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Comparación constant-time.
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return { ok: false, reason: 'bad signature' };
    if (!timingSafeEqual(a, b)) return { ok: false, reason: 'bad signature' };

    return { ok: true, ytId: yt || null };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);

      // CORS — restringido a orígenes esperados (PWA Vercel + dev local).
      // Reflejamos el origin si pertenece a una lista blanca; si no, '*'
      // (modo permisivo para tooling/curl). Audio Range solicitudes desde
      // <audio> no envían Origin, así que '*' es necesario por defecto.
      const origin = req.headers.origin ?? '';
      const allowedOrigin = ALLOWED_ORIGINS.some((re) => re.test(origin)) ? origin : '*';
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'ritmiq', version: '0.1.0' }));
        return;
      }

      // ── Panel de administración (owner-auth) ─────────────────────────
      // Página web para gestionar dispositivos desde el móvil sin SSH.
      // Autenticación por access-token del dueño (Bearer o ?token=).
      if (url.pathname === '/admin' || url.pathname === '/admin/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ADMIN_HTML);
        return;
      }
      if (url.pathname.startsWith('/admin/api/')) {
        if (!isOwner(req, url)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        // GET /admin/api/state → dispositivos + solicitudes pendientes.
        if (url.pathname === '/admin/api/state' && req.method === 'GET') {
          const devices = listDevices(db).map((d) => ({
            device_id: d.device_id,
            display_name: d.display_name,
            supabase_user_id: d.supabase_user_id,
            status: d.status,
            has_cookies: !!(d.cookies_updated_at),
            last_seen_at: d.last_seen_at,
            approved_at: d.approved_at,
          }));
          const pending = listPairRequests(db).map((p) => ({
            device_id: p.device_id,
            display_name: p.display_name,
            supabase_user_id: p.supabase_user_id,
            pin: p.pin,
            requested_at: p.requested_at,
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ devices, pending }));
          return;
        }
        // POST /admin/api/{approve,reject,revoke} { device_id }
        if (req.method === 'POST') {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
              const id = String(body.device_id || '');
              if (!id) { res.writeHead(400).end('device_id required'); return; }
              if (url.pathname === '/admin/api/approve') {
                const pend = listPairRequests(db).find((r) => r.device_id === id);
                const token = approveDevice(db, {
                  deviceId: id,
                  displayName: pend?.display_name ?? id,
                  supabaseUserId: pend?.supabase_user_id ?? null,
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, deviceToken: token }));
              } else if (url.pathname === '/admin/api/reject') {
                rejectPairRequest(db, id);
                res.writeHead(200).end(JSON.stringify({ ok: true }));
              } else if (url.pathname === '/admin/api/revoke') {
                revokeDevice(db, id);
                res.writeHead(200).end(JSON.stringify({ ok: true }));
              } else {
                res.writeHead(404).end('not found');
              }
            } catch (err) {
              res.writeHead(500).end('internal error');
            }
          });
          return;
        }
        res.writeHead(405).end('method not allowed');
        return;
      }

      // ── Administración POR CUENTA (owner o sub-admin) ────────────────
      // A diferencia de /admin/api/* (owner-only, panel web global), estos
      // endpoints admiten JWT de Supabase o device_token: cada cuenta ve y
      // gestiona SOLO sus propios dispositivos. El owner puede con todos.
      if (url.pathname.startsWith('/devices/')) {
        const principal = await authorizeAdmin(req, url);
        if (!principal) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        const isAdminOwner = principal.owner === true;
        const myUserId = isAdminOwner ? null : principal.userId;

        // GET /devices/mine → devices + pending de la cuenta (o todos si owner).
        if (url.pathname === '/devices/mine' && req.method === 'GET') {
          const devices = isAdminOwner
            ? listDevices(db)
            : listDevicesForUser(db, myUserId);
          const pending = isAdminOwner
            ? listPairRequests(db)
            : listPairRequestsForUser(db, myUserId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            owner: isAdminOwner,
            userId: myUserId ?? null,
            devices: devices.map((d) => ({
              device_id: d.device_id,
              display_name: d.display_name,
              supabase_user_id: d.supabase_user_id,
              status: d.status,
              has_cookies: !!d.cookies_updated_at,
              last_seen_at: d.last_seen_at,
              approved_at: d.approved_at,
            })),
            pending: pending.map((p) => ({
              device_id: p.device_id,
              display_name: p.display_name,
              supabase_user_id: p.supabase_user_id,
              pin: p.pin,
              requested_at: p.requested_at,
              has_cookies: !!p.has_cookies,
            })),
          }));
          return;
        }

        // POST /devices/{approve,reject,revoke,rename}  { device_id, ... }
        if (req.method === 'POST') {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
              const id = String(body.device_id || '');
              if (!id) { res.writeHead(400).end('device_id required'); return; }
              // Verificación de pertenencia para sub-admins.
              if (!isAdminOwner) {
                const ownerId = getDeviceOwnerUserId(db, id);
                if (!myUserId || ownerId !== myUserId) {
                  res.writeHead(403, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'forbidden: not your device' }));
                  return;
                }
              }
              if (url.pathname === '/devices/approve') {
                const pend = listPairRequests(db).find((r) => r.device_id === id);
                const token = approveDevice(db, {
                  deviceId: id,
                  displayName: pend?.display_name ?? id,
                  supabaseUserId: pend?.supabase_user_id ?? (isAdminOwner ? null : myUserId),
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, deviceToken: token }));
              } else if (url.pathname === '/devices/reject') {
                rejectPairRequest(db, id);
                res.writeHead(200).end(JSON.stringify({ ok: true }));
              } else if (url.pathname === '/devices/revoke') {
                revokeDevice(db, id);
                try { invalidateDeviceCookies(id); } catch {}
                res.writeHead(200).end(JSON.stringify({ ok: true }));
              } else if (url.pathname === '/devices/rename') {
                renameDevice(db, id, String(body.name || ''));
                res.writeHead(200).end(JSON.stringify({ ok: true }));
              } else if (url.pathname === '/devices/cookies') {
                // Aportar cookies a un device (Fase 4c). Body: { cookies_b64 }.
                const cookiesB64 = body.cookies_b64;
                if (!cookiesB64) { res.writeHead(400).end('cookies_b64 required'); return; }
                const raw = Buffer.from(String(cookiesB64), 'base64').toString('utf8');
                if (raw.length > 1024 * 1024) { res.writeHead(413).end('cookies too large'); return; }
                const blob = encryptCookies(raw);
                updateDeviceCookies(db, id, blob);
                try { invalidateDeviceCookies(id); } catch {}
                res.writeHead(200).end(JSON.stringify({ ok: true }));
              } else {
                res.writeHead(404).end('not found');
              }
            } catch (err) {
              console.error('[lan-server] /devices error', err);
              res.writeHead(500).end('internal error');
            }
          });
          return;
        }
        res.writeHead(405).end('method not allowed');
        return;
      }

      // ── Pareo: endpoints publicos con rate-limit ─────────────────────
      // Permiten a una PWA solicitar pareo y consultar el estado sin
      // necesidad de token (no lo tienen todavia). Rate-limit por IP.
      if (url.pathname === '/pair' && req.method === 'POST') {
        const clientIp = String(
          req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
          req.socket.remoteAddress || ''
        );
        if (!pairRateLimit(clientIp)) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'rate limited' }));
          return;
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            const { device_id, display_name, supabase_user_id, pin, cookies_b64 } = body;
            if (!device_id || !display_name || !pin) {
              res.writeHead(400).end('device_id, display_name, pin required');
              return;
            }
            // Identidad de la cuenta: SIEMPRE del JWT verificado si viene uno.
            // El supabase_user_id del body es autodeclarado y no confiable; solo
            // se usa como fallback si NO se exige login (modo abierto/legacy).
            let trustedUserId = null;
            const bearer = extractBearer(req, url);
            if (bearer && bearer !== accessToken && jwtVerifier.isConfigured()) {
              const verified = await jwtVerifier.verify(bearer);
              if (verified) trustedUserId = verified.userId;
            }
            if (REQUIRE_AUTH_FOR_PAIR && !trustedUserId) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'login required to pair' }));
              return;
            }
            const effectiveUserId = trustedUserId
              ? trustedUserId
              : (REQUIRE_AUTH_FOR_PAIR ? null : (supabase_user_id ? String(supabase_user_id) : null));
            // Cifrar cookies (si vienen) antes de guardarlas en el pair_request.
            const cookiesBlob = cookies_b64
              ? encryptCookies(Buffer.from(String(cookies_b64), 'base64').toString('utf8'))
              : null;
            const out = createPairRequest(db, {
              deviceId: String(device_id),
              displayName: String(display_name),
              supabaseUserId: effectiveUserId,
              pin: String(pin),
              cookiesBlob,
              clientIp,
              allowedUsers: ALLOWED_USERS,
            });
            if (out.status === 'pending') {
              notifyOwnerNewPairRequest({
                deviceId: String(device_id),
                displayName: String(display_name),
                pin: String(pin),
              });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(out));
          } catch (err) {
            console.error('[lan-server] /pair error', err);
            res.writeHead(500).end('internal error');
          }
        });
        return;
      }
      if (url.pathname === '/pair/status' && req.method === 'GET') {
        const deviceId = url.searchParams.get('device_id');
        if (!deviceId) { res.writeHead(400).end('device_id required'); return; }
        const st = getPairStatus(db, deviceId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(st));
        return;
      }

      // Resto de rutas: requieren autenticación si hay accessToken configurado.
      //
      // EXCEPCIONES (no requieren token Bearer):
      //   1. /stream/* y /download/* con `?sig=...&exp=...` — se autorizan
      //      por firma HMAC validada despues contra STREAM_SIGNING_SECRET.
      //      La PWA en navegador puede no tener token en localStorage pero
      //      sí obtiene URLs firmadas via Edge sign-stream.
      //   2. En modo ACCEPT_UNSIGNED (compat): se bypasea el token check
      //      para /yt/*, /stream/*, /download/*. La autorización real se
      //      hace mas adentro (sig HMAC o presencia en SQLite local).
      //      Esto es necesario porque la PWA en PC carga desde Vercel y a
      //      veces no tiene el token sincronizado en localStorage —
      //      sintoma clasico: 401 en /yt/prewarm o /download/ aunque la
      //      sesion Supabase sea valida.
      const isSignedStreamRequest =
        (url.pathname.startsWith('/stream/') || url.pathname.startsWith('/download/')) &&
        url.searchParams.has('sig') && url.searchParams.has('exp');
      const isCompatExempt =
        ACCEPT_UNSIGNED && (
          url.pathname.startsWith('/yt/') ||
          url.pathname.startsWith('/stream/') ||
          url.pathname.startsWith('/download/') ||
          url.pathname === '/shared-cache/check'
        );
      // Modelo Y: ademas del owner token, aceptamos device_token aprobado
      // para todos los endpoints de musica (/yt/*, /stream/*, /download/*,
      // /cookies/upload). La fila del device la usan los handlers para
      // decidir cookies y registrar activity.
      const isMusicEndpoint =
        url.pathname.startsWith('/yt/') ||
        url.pathname.startsWith('/stream/') ||
        url.pathname.startsWith('/download/') ||
        url.pathname === '/cookies/upload' ||
        url.pathname.startsWith('/youtube/link') ||
        url.pathname === '/youtube/unlink' ||
        url.pathname === '/shared-cache/check';
      const principal = isMusicEndpoint ? authorizeDeviceOrOwner(req, url) : null;
      const isDeviceAuth = isMusicEndpoint && principal != null;
      if (!isSignedStreamRequest && !isCompatExempt && !isDeviceAuth && !isAuthorized(req, url)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (url.pathname === '/yt/search') {
        const q = url.searchParams.get('q');
        if (!q) { res.writeHead(400).end('q required'); return; }
        const opts = ytOptsFor(principal);
        // max=15: el PWA aplica dedupe contra la biblioteca local y se
        // queda con un minimo de 8 visibles aunque haya solapamiento.
        const items = await search(q, { ...opts, max: 15 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items }));

        if (principal && principal.owner !== true) {
          try { logActivity(db, { deviceId: principal.device_id, action: 'search', meta: { q } }); } catch {}
        }

        // Pre-resolver los stream URLs de los 2 primeros resultados en
        // background con prioridad BAJA. Reducimos de 3→2 para no saturar
        // la cola de yt-dlp cuando el usuario hace varias búsquedas seguidas.
        // El click real será prioridad ALTA y saltará la cola.
        for (const it of items.slice(0, 2)) {
          if (it?.id) resolveCached(it.id, 1).catch(() => {});
        }
        return;
      }

      // Permite al cliente "calentar" el cache antes de pulsar play.
      // Prioridad MEDIA — el usuario ya mostró intención (touch/hover sobre
      // el resultado), pero todavía no es un stream comprometido.
      if (url.pathname === '/yt/prewarm') {
        const ytId = url.searchParams.get('q');
        if (!ytId) { res.writeHead(400).end('q required'); return; }
        resolveCached(ytId, 5).catch(() => {});
        res.writeHead(204).end();
        return;
      }

      // Subida de cookies por device. Requiere device_token (no acepta owner
      // porque el owner ya tiene cookiesFromBrowser activas).
      if (url.pathname === '/cookies/upload' && req.method === 'POST') {
        if (!principal || principal.owner === true) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'device_token required' }));
          return;
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            const b64 = body.cookies_b64;
            if (!b64) { res.writeHead(400).end('cookies_b64 required'); return; }
            const text = Buffer.from(String(b64), 'base64').toString('utf8');
            if (text.length > 1024 * 1024) {
              res.writeHead(413).end('cookies too large');
              return;
            }
            // Cifrar antes de persistir (safeStorage / AES-GCM / plain:).
            const blob = encryptCookies(text);
            updateDeviceCookies(db, principal.device_id, blob);
            invalidateDeviceCookies(principal.device_id);
            logActivity(db, {
              deviceId: principal.device_id, action: 'cookies_upload',
              meta: { size: text.length },
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (err) {
            console.error('[lan-server] /cookies/upload error', err);
            res.writeHead(500).end('internal error');
          }
        });
        return;
      }

      // ─── Login de YouTube por navegador (Fase 3b) ──────────────────────
      // Requiere device_token. Orquesta un contenedor noVNC bajo demanda.

      // POST /youtube/link/start → { novncPort, status } o 503 si no hay Docker.
      if (url.pathname === '/youtube/link/start' && req.method === 'POST') {
        if (!principal || principal.owner === true) {
          res.writeHead(403).end(JSON.stringify({ error: 'device_token required' }));
          return;
        }
        (async () => {
          try {
            if (!(await isDockerAvailable())) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'docker no disponible en el servidor' }));
              return;
            }
            const out = await startLoginSession({
              deviceId: principal.device_id,
              deviceToken: extractBearer(req, url),
              serverPort: actualPort,
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(out));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(e?.message ?? e) }));
          }
        })();
        return;
      }

      // GET /youtube/link/status → { status, novncPort }
      if (url.pathname === '/youtube/link/status' && req.method === 'GET') {
        if (!principal || principal.owner === true) {
          res.writeHead(403).end(JSON.stringify({ error: 'device_token required' }));
          return;
        }
        (async () => {
          const hasCookies = (deviceId) => {
            try {
              const row = db.prepare('SELECT cookies_blob FROM devices WHERE device_id = ?').get(deviceId);
              return !!(row && row.cookies_blob && row.cookies_blob.length > 0);
            } catch { return false; }
          };
          const out = await getLoginStatus(principal.device_id, hasCookies);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(out));
        })();
        return;
      }

      // POST /youtube/unlink → borra cookies del device + detiene sesión.
      if (url.pathname === '/youtube/unlink' && req.method === 'POST') {
        if (!principal || principal.owner === true) {
          res.writeHead(403).end(JSON.stringify({ error: 'device_token required' }));
          return;
        }
        (async () => {
          try {
            clearDeviceCookies(db, principal.device_id);
            invalidateDeviceCookies(principal.device_id);
            await stopLoginSession(principal.device_id);
            logActivity(db, { deviceId: principal.device_id, action: 'youtube_unlink' });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(e?.message ?? e) }));
          }
        })();
        return;
      }

      // ─── CONTEXTO HISTÓRICO: endpoint /yt/streamurl ────────────────────
      // Diseñamos este endpoint para que el cliente pudiera asignar la URL
      // DIRECTA de googlevideo a `audio.src` y bypassear el proxy (mucho
      // más rápido: -300ms TTFB × decenas de Range requests de Safari).
      // PERO las URLs de googlevideo están firmadas con la IP del PC; al
      // intentarlo desde el iPhone vía Tunnel, googlevideo respondía 403
      // y el cliente caía al fallback proxy. Se hacía doble round-trip y
      // resultaba MÁS lento que el camino directo al proxy.
      //
      // Endpoint eliminado en commit de limpieza. Se conserva este
      // comentario para que futuras iteraciones (signed URLs, mismo-mesh
      // vía Tailscale, etc.) sepan que ya se intentó y por qué falla.
      // El código original está en git history en el commit de Cambio 4.
      // ──────────────────────────────────────────────────────────────────

      if (url.pathname === '/yt/metadata') {
        const idOrUrl = url.searchParams.get('q');
        if (!idOrUrl) { res.writeHead(400).end('q required'); return; }
        const meta = await getMetadata(idOrUrl, ytOptsFor(principal));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(meta));
        return;
      }

      // Importación de playlists públicas de Spotify (sin OAuth).
      // Lee el embed público y extrae name + tracks. Funciona con
      // cualquier URL share de spotify (open.spotify.com/playlist/<id>...).
      if (url.pathname === '/spotify/playlist') {
        const spUrl = url.searchParams.get('url');
        if (!spUrl) { res.writeHead(400).end('url required'); return; }
        try {
          const data = await fetchSpotifyPlaylist(spUrl);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (err) {
          console.error('[lan-server] spotify error', err);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err?.message ?? err) }));
        }
        return;
      }

      // ─── Cache compartido: check bulk de ytIds ──────────────────────────
      // Devuelve subset de ytIds que estan en shared_audio. Usado por la
      // PWA tras un search para mostrar badge 'En cache del PC' en los
      // resultados que se reproducirian al instante. Cap 100 ids/request.
      if (url.pathname === '/shared-cache/check' && req.method === 'GET') {
        const ytParam = url.searchParams.get('yt') ?? '';
        const ytIds = ytParam.split(',').map((s) => s.trim()).filter(Boolean);
        const cached = findSharedAudioBulk(db, ytIds);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          // Pequeño cache HTTP para que repetir el mismo search no spamee.
          'Cache-Control': 'private, max-age=30',
        });
        res.end(JSON.stringify({ cached: Array.from(cached) }));
        return;
      }

      // ─── Cache compartido: stats + clear ───────────────────────────────
      // Endpoints administrativos para la UI (botón "Limpiar caché
      // compartido"). Requieren Bearer token (ya validado arriba); no
      // requieren firma HMAC porque no exponen audio.
      if (url.pathname === '/shared-cache') {
        if (req.method === 'GET') {
          const s = sharedAudioStats(db);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(s));
          return;
        }
        if (req.method === 'DELETE') {
          const r = clearSharedAudio(db);
          console.log(`[lan-server] shared-cache clear: ${r.removed} files, ${r.freedBytes} bytes`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(r));
          return;
        }
        res.writeHead(405).end('method not allowed');
        return;
      }

      // ─── Descarga rápida vía yt-dlp ────────────────────────────────────
      // La PWA pide aquí en lugar de /stream para obtener el archivo
      // entero (paralelismo HTTP de yt-dlp) en lugar de un proxy en vivo
      // limitado al bitrate del audio. Si el archivo ya está en cache
      // compartido se sirve instantáneamente (cualquier user benefició).
      // Bloqueante: la respuesta espera a que yt-dlp termine. Para la
      // PWA equivale a un fetch que tarda 2-5s en empezar a recibir
      // bytes y luego entrega el archivo a velocidad de transferencia
      // local — mucho más rápido que el proxy actual.
      if (url.pathname.startsWith('/download/')) {
        const trackId = decodeURIComponent(url.pathname.slice('/download/'.length));
        const sigCheck = validateStreamSignature(trackId, url.searchParams);
        const localRow = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);

        let ytId = null;
        // Modelo Y: device autorizado puede pedir descarga indicando ytId
        // por query string (su track no esta en la SQLite del owner).
        const ytFromQs = url.searchParams.get('yt');
        // DIAGNOSTIC
        console.log(
          `[lan-server] /download/${trackId} ` +
          `principal=${principal ? (principal.owner ? 'owner' : `device:${principal.device_id?.slice(0, 8)}`) : 'none'} ` +
          `sigOk=${sigCheck.ok} ` +
          `ytFromQs=${ytFromQs ? ytFromQs : '-'} ` +
          `localRow=${localRow ? `yt=${localRow.yt_id ?? '-'}/dl=${!!localRow.is_downloaded}` : '-'}`
        );
        if (sigCheck.ok) {
          ytId = sigCheck.ytId || localRow?.yt_id || null;
        } else if (principal && principal.owner !== true) {
          ytId = ytFromQs || localRow?.yt_id || null;
        } else if (ACCEPT_UNSIGNED && (localRow?.source === 'youtube' && localRow.yt_id)) {
          ytId = localRow.yt_id;
        } else if (ACCEPT_UNSIGNED && ytFromQs) {
          ytId = ytFromQs;
        } else {
          const status = sigCheck.reason === 'expired' ? 401 : 403;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: sigCheck.reason ?? 'unauthorized' }));
          return;
        }
        if (!ytId) {
          res.writeHead(404).end('source unavailable');
          return;
        }

        // Hit en cache compartido — servimos archivo y listo.
        const cached = findSharedAudio(db, ytId);
        if (cached) {
          console.log(`[lan-server] download ${ytId} CACHE HIT`);
          if (principal && principal.owner !== true) {
            try { logActivity(db, { deviceId: principal.device_id, action: 'download_cached', trackId, ytId }); } catch {}
          }
          return serveLocalFile(req, res, cached.filePath);
        }

        // Miss → descargar con yt-dlp. Coalesce: si otro cliente pide el
        // mismo ytId al mismo tiempo, esperan ambos al mismo trabajo.
        try {
          const filePath = await downloadSharedAudio(ytId, ytOptsFor(principal));
          if (principal && principal.owner !== true) {
            try { logActivity(db, { deviceId: principal.device_id, action: 'download', trackId, ytId }); } catch {}
          }
          return serveLocalFile(req, res, filePath);
        } catch (err) {
          console.warn(`[lan-server] download ${ytId} FAIL`, err.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          // Opcion B: mensaje user-friendly. El stderr crudo de yt-dlp se
          // queda en el log del desktop para diagnostico, no se manda al
          // navegador.
          res.end(JSON.stringify({ error: translateYtdlpError(err) }));
          return;
        }
      }

      if (url.pathname.startsWith('/stream/')) {
        const trackId = decodeURIComponent(url.pathname.slice('/stream/'.length));

        // Track efímero: el id viene como "yt:<ytId>". Antes de invocar
        // yt-dlp (que tarda 1-6s), comprobamos si la cancion ya esta
        // descargada localmente en este desktop:
        //
        //   1. tracks(yt_id = ytId, is_downloaded = 1) — descargada por
        //      el OWNER de este desktop. Caso comun: el user reproduce
        //      desde su PWA una cancion que ya tiene en disco.
        //   2. shared_audio(yt_id = ytId) — cualquier archivo indexado
        //      por la app (incluye Library propia, no solo cache compartido).
        //
        // BUG ANTERIOR: el path ephemeral iba DIRECTO a resolveCached →
        // yt-dlp invocado innecesariamente cuando el archivo estaba
        // en disco. Esto pasaba siempre que la PWA pedia un track por
        // ?yt:<ytId> y el owner ya lo tenia descargado — el ID interno
        // de tracks() no se conoce desde la PWA, asi que cae al prefijo
        // efimero pero el archivo SI existe localmente.
        if (trackId.startsWith('yt:')) {
          const ytId = trackId.slice(3);
          const tStart = Date.now();

          // 1. Tracks descargados del owner (lookup por yt_id).
          try {
            const localRow = db
              .prepare('SELECT file_path FROM tracks WHERE yt_id = ? AND is_downloaded = 1 LIMIT 1')
              .get(ytId);
            if (localRow?.file_path && existsSync(localRow.file_path)) {
              console.log(`[lan-server] stream yt:${ytId} LOCAL HIT (owner download) ${Date.now() - tStart}ms`);
              return serveLocalFile(req, res, localRow.file_path);
            }
          } catch (err) {
            console.warn(`[lan-server] lookup tracks by yt_id fallo (no fatal): ${err?.message ?? err}`);
          }

          // 2. shared_audio (cache compartido + indice de todos los
          //    archivos descargados de la app via backfill al arranque).
          try {
            const shared = findSharedAudio(db, ytId);
            if (shared?.filePath && existsSync(shared.filePath)) {
              console.log(`[lan-server] stream yt:${ytId} SHARED HIT ${Date.now() - tStart}ms`);
              return serveLocalFile(req, res, shared.filePath);
            }
          } catch (err) {
            console.warn(`[lan-server] findSharedAudio fallo (no fatal): ${err?.message ?? err}`);
          }

          // 3. Fallback: yt-dlp. Prioridad MAXIMA (10): el usuario YA
          //    pulso play. Si hay otros prewarms encolados, este se
          //    cuela al frente.
          const streamUrl = await resolveCached(ytId, 10);
          const tResolved = Date.now();
          console.log(
            `[lan-server] stream yt:${ytId} resolve=${tResolved - tStart}ms ` +
            `clientRange=${req.headers.range ?? '-'}`
          );
          return proxyAudio(req, res, streamUrl);
        }

        // ── Autorización: firma HMAC emitida por Edge `sign-stream` ───────
        //
        // Path principal: la PWA llamó a `/functions/v1/sign-stream` con su
        // JWT (RLS validó que el track es del user) y recibió URL firmada.
        // Aquí solo validamos la firma — autorización ya hecha en Supabase.
        //
        // El payload firmado incluye `ytId`, así podemos resolver yt-dlp
        // SIN consultar nuestra SQLite ni Supabase. Multi-tenant gratis.
        const sigCheck = validateStreamSignature(trackId, url.searchParams);

        // SQLite local (path rápido — owner del desktop). Útil tanto para
        // tracks descargados como cuando la firma falta y ACCEPT_UNSIGNED
        // está activo.
        const localRow = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);

        // Path A: firma HMAC valida → sigCheck.ok = true
        // Path B: device_token aprobado → principal != null
        // Path C: ACCEPT_UNSIGNED y track en SQLite local
        const ytFromQs = url.searchParams.get('yt');
        // DIAGNOSTIC: facilita ver por que un /stream fallo (4xx) cuando
        // hay nuevos devices reportando "code 4" en la PWA.
        console.log(
          `[lan-server] /stream/${trackId} ` +
          `principal=${principal ? (principal.owner ? 'owner' : `device:${principal.device_id?.slice(0, 8)}`) : 'none'} ` +
          `sigOk=${sigCheck.ok} ` +
          `ytFromQs=${ytFromQs ? ytFromQs : '-'} ` +
          `localRow=${localRow ? `yt=${localRow.yt_id ?? '-'}/dl=${!!localRow.is_downloaded}` : '-'}`
        );

        // Path A: firma HMAC
        if (sigCheck.ok) {
          const ytId = sigCheck.ytId || localRow?.yt_id;
          if (localRow?.is_downloaded && localRow.file_path && existsSync(localRow.file_path)) {
            return serveLocalFile(req, res, localRow.file_path);
          }
          if (ytId) {
            const shared = findSharedAudio(db, ytId);
            if (shared) {
              console.log(`[lan-server] stream ${trackId} SHARED HIT ytId=${ytId}`);
              return serveLocalFile(req, res, shared.filePath);
            }
            const streamUrl = await resolveCached(ytId, 10);
            return proxyAudio(req, res, streamUrl);
          }
          res.writeHead(404).end('source unavailable');
          return;
        }

        // Path B: device pareado (Modelo Y). El device conoce el ytId.
        if (principal && principal.owner !== true) {
          const ytId = ytFromQs || localRow?.yt_id || null;
          if (!ytId) {
            res.writeHead(404).end('source unavailable (no ytId)');
            return;
          }
          // Cache hit cross-account: lo que el user pidio.
          const shared = findSharedAudio(db, ytId);
          if (shared) {
            console.log(`[lan-server] stream ${trackId} SHARED HIT (device) ytId=${ytId}`);
            try { logActivity(db, { deviceId: principal.device_id, action: 'stream_shared', trackId, ytId }); } catch {}
            return serveLocalFile(req, res, shared.filePath);
          }
          // SQLite local (track del owner descargado).
          if (localRow?.is_downloaded && localRow.file_path && existsSync(localRow.file_path)) {
            return serveLocalFile(req, res, localRow.file_path);
          }
          const streamUrl = await resolveCached(ytId, 10, ytOptsFor(principal));
          try { logActivity(db, { deviceId: principal.device_id, action: 'stream', trackId, ytId }); } catch {}
          return proxyAudio(req, res, streamUrl);
        }

        // Path C: compat ACCEPT_UNSIGNED (legacy PWA sin firma ni device).
        if (ACCEPT_UNSIGNED && localRow) {
          if (localRow.is_downloaded && localRow.file_path && existsSync(localRow.file_path)) {
            return serveLocalFile(req, res, localRow.file_path);
          }
          if (localRow.source === 'youtube' && localRow.yt_id) {
            const shared = findSharedAudio(db, localRow.yt_id);
            if (shared) return serveLocalFile(req, res, shared.filePath);
            const streamUrl = await resolveCached(localRow.yt_id, 10);
            return proxyAudio(req, res, streamUrl);
          }
        }
        // ACCEPT_UNSIGNED + ytId por query (sin localRow): util cuando un
        // device legacy sin pairing trae el ytId en la URL.
        if (ACCEPT_UNSIGNED && ytFromQs) {
          const shared = findSharedAudio(db, ytFromQs);
          if (shared) return serveLocalFile(req, res, shared.filePath);
          const streamUrl = await resolveCached(ytFromQs, 10);
          return proxyAudio(req, res, streamUrl);
        }

        // Rechazo: firma inválida y no hay fallback.
        const status = sigCheck.reason === 'expired' ? 401 : 403;
        console.warn(`[lan-server] /stream/${trackId} rechazado: ${sigCheck.reason}`);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: sigCheck.reason }));
        return;
      }

      res.writeHead(404).end('not found');
    } catch (err) {
      console.error('[lan-server]', err);
      res.writeHead(500).end('internal error');
    }
  });

  // Intentar el puerto preferido; si está ocupado probar los siguientes.
  // Esto evita crashes si hay otra instancia de Ritmiq corriendo.
  const actualPort = await listenWithFallback(server, port, 5);
  console.log(`[lan-server] listening on :${actualPort}`);

  // Anuncio mDNS
  let bonjour = null;
  let advert = null;
  try {
    bonjour = new Bonjour();
    advert = bonjour.publish({
      name: 'Ritmiq',
      type: 'ritmiq',
      protocol: 'tcp',
      port: actualPort,
      txt: { version: '0.1.0' },
    });
  } catch (err) {
    console.warn('[lan-server] mDNS no disponible:', err.message);
  }

  return {
    port: actualPort,
    /** Suscribe al renderer a nuevos pair requests (para notificacion + UI). */
    onPairRequest,
    stop: async () => {
      try { advert?.stop?.(); } catch {}
      try { bonjour?.destroy(); } catch {}
      await new Promise((r) => server.close(r));
    },
  };
}

/**
 * Intenta escuchar en `startPort`; si está ocupado, prueba los siguientes
 * hasta `tries` puertos. Devuelve el puerto que terminó funcionando.
 */
function listenWithFallback(server, startPort, tries = 5) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (p) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && attempt < tries) {
          attempt++;
          server.removeListener('error', onError);
          console.warn(`[lan-server] puerto :${p} ocupado, probando :${p + 1}`);
          tryPort(p + 1);
        } else {
          server.removeListener('error', onError);
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(p, () => {
        server.removeListener('error', onError);
        resolve(p);
      });
    };
    tryPort(startPort);
  });
}

/**
 * Proxy de audio: el PC pide la URL real de googlevideo (que está atada a
 * su IP) y reenvía los bytes al cliente (PWA/iPhone). Soporta Range para
 * que el reproductor pueda hacer seek.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} upstreamUrl
 */
async function proxyAudio(req, res, upstreamUrl) {
  /** @type {Record<string,string>} */
  const headers = {
    // Algunos servidores de googlevideo requieren UA reciente.
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
                  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
  if (req.headers.range) headers['Range'] = String(req.headers.range);

  const upstream = await fetch(upstreamUrl, { headers });

  // Pasamos los headers relevantes
  const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
  for (const h of passthrough) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }

  // NOTA: anteriormente inyectábamos Content-Length/Content-Range derivados
  // del parámetro `clen` de la URL de googlevideo para que iOS lockscreen
  // mostrase el layout "música" con prev/next en lugar de podcast ±10s.
  // Esto producía duraciones infladas en PWA (tunnel): cuando googlevideo
  // respondía chunked con un segmento DASH parcial, declarábamos `clen`
  // como total → Safari computaba `duration ≈ clen / bitrate` y arrojaba
  // valores 2–3x los reales, con minutos de silencio audible al final.
  // Decisión: aceptar el layout ±10s en lockscreen a cambio de que la
  // duración sea siempre la real (leída del moov del MP4 por el cliente).
  console.log(
    `[lan-server] proxy ${req.method} status=${upstream.status} ` +
    `clientRange=${req.headers.range ?? '-'} ` +
    `upstreamCL=${upstream.headers.get('content-length') ?? '-'} ` +
    `upstreamCR=${upstream.headers.get('content-range') ?? '-'}`
  );

  if (!upstream.headers.get('accept-ranges')) {
    res.setHeader('Accept-Ranges', 'bytes');
  }
  // Forzar audio/mp4 si no viene tipo (Safari es muy estricto).
  if (!upstream.headers.get('content-type')) {
    res.setHeader('Content-Type', 'audio/mp4');
  }
  // Evitar que cachés intermedias guarden respuestas parciales (Range).
  // En PWA iOS, una respuesta 206 cacheada puede confundir al <audio>
  // cuando hace el siguiente Range request — síntoma: la barra avanza
  // pero el audio se queda mudo.
  res.setHeader('Cache-Control', 'no-store, no-transform');

  res.writeHead(upstream.status);

  if (!upstream.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(upstream.body);
  // Si el cliente cierra (Safari abortando rangos al cambiar de track),
  // marcamos para suprimir el error de upstream que llega justo después
  // del destroy() — son aborts normales, no fallos reales del stream.
  let clientClosed = false;
  nodeStream.on('error', (err) => {
    if (clientClosed) return; // abort intencional, ignorar
    console.warn('[lan-server] proxy stream error', err.message);
    if (!res.headersSent) {
      try { res.writeHead(502); } catch {}
    }
    try { res.end(); } catch {}
  });
  res.on('close', () => {
    clientClosed = true;
    // Abortamos el upstream — el cliente ya no recibe bytes. Errores
    // posteriores en nodeStream (ECONNRESET, AbortError) son esperados.
    try { nodeStream.destroy(); } catch {}
  });
  nodeStream.pipe(res);
}

/**
 * Extrae el ID de playlist de Spotify desde una URL share.
 *  - https://open.spotify.com/playlist/<id>?si=...
 *  - spotify:playlist:<id>
 * @param {string} input
 * @returns {string|null}
 */
function parseSpotifyPlaylistId(input) {
  if (!input) return null;
  let m = input.match(/playlist[:\/]([a-zA-Z0-9]{16,})/);
  if (m) return m[1];
  return null;
}

/**
 * Descarga el embed público y extrae nombre + lista de tracks.
 * No requiere OAuth (mismo método que demus.app).
 * Limitación: hasta 100 tracks por playlist en el embed público.
 *
 * @param {string} input  URL completa o ID
 * @returns {Promise<{name:string, description:string|null, coverUrl:string|null, tracks:Array<{title:string,artist:string,durationMs:number}>}>}
 */
async function fetchSpotifyPlaylist(input) {
  const id = parseSpotifyPlaylistId(input) ?? input.trim();
  if (!/^[a-zA-Z0-9]{16,}$/.test(id)) {
    throw new Error('No se reconoce un ID de playlist de Spotify en la URL');
  }
  const embedUrl = `https://open.spotify.com/embed/playlist/${id}`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Spotify embed ${res.status}`);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('No se encontró el bloque de datos en el embed');
  /** @type {any} */
  const json = JSON.parse(match[1]);
  const entity = json?.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error('Estructura del embed inesperada');

  /** @type {Array<any>} */
  const trackList = entity.trackList ?? [];
  const tracks = trackList
    .filter((t) => t?.title && t?.subtitle)
    .map((t) => ({
      title: String(t.title),
      artist: String(t.subtitle),
      durationMs: Number(t.duration ?? 0),
    }));

  const coverUrl = entity.coverArt?.sources?.[0]?.url ?? null;

  return {
    name: String(entity.name ?? entity.title ?? 'Playlist de Spotify'),
    description: typeof entity.description === 'string' ? entity.description : null,
    coverUrl,
    tracks,
  };
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} filePath
 */
function serveLocalFile(req, res, filePath) {
  const stat = statSync(filePath);
  const range = req.headers.range;
  const mime = filePath.endsWith('.opus') ? 'audio/ogg'
             : filePath.endsWith('.m4a')  ? 'audio/mp4'
             : filePath.endsWith('.mp3')  ? 'audio/mpeg'
             : 'application/octet-stream';

  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Type': mime,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(filePath).pipe(res);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Panel de administración (HTML autocontenido). Se sirve en GET /admin.
// El dueño pega su access-token; las llamadas a /admin/api/* lo mandan
// como Bearer. Sin dependencias externas.
// ─────────────────────────────────────────────────────────────────────
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ritmiq — Administración</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, sans-serif; background:#0a0a0c; color:#e8e8ea; padding:16px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .muted { color:#9a9aa2; font-size:13px; }
  .card { background:#151519; border:1px solid #26262c; border-radius:12px; padding:14px; margin:12px 0; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid #202027; }
  .row:last-child { border-bottom:0; }
  .name { font-weight:600; }
  .sub { color:#9a9aa2; font-size:12px; }
  input { width:100%; padding:10px; border-radius:8px; border:1px solid #303038; background:#0f0f13; color:#e8e8ea; font-size:14px; }
  button { border:0; border-radius:8px; padding:8px 12px; font-size:13px; font-weight:600; cursor:pointer; }
  .btn-approve { background:#3ddc97; color:#062a1c; }
  .btn-reject { background:#2a2a31; color:#e8e8ea; }
  .btn-revoke { background:#ff5d6c; color:#2a0a0d; }
  .pin { font-family: monospace; font-size:18px; letter-spacing:2px; color:#c9a6ff; }
  .badge { font-size:11px; padding:2px 8px; border-radius:999px; background:#26262c; color:#9a9aa2; }
  .badge.yt { background:#1e3a2a; color:#3ddc97; }
  .empty { color:#6a6a72; font-size:13px; padding:10px 0; }
</style>
</head>
<body>
  <h1>Ritmiq — Administración</h1>
  <p class="muted">Gestiona los dispositivos que pueden usar este servidor.</p>

  <div class="card" id="auth-card">
    <label class="muted">Access-token del dueño</label>
    <input id="token" type="password" placeholder="pega tu access-token" autocomplete="off">
    <div style="margin-top:10px"><button class="btn-approve" onclick="save()">Guardar y cargar</button></div>
  </div>

  <div id="content" style="display:none">
    <div class="card">
      <h3 style="margin:0 0 8px">Solicitudes pendientes</h3>
      <div id="pending"></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 8px">Dispositivos</h3>
      <div id="devices"></div>
    </div>
  </div>

<script>
  const tokenKey = 'ritmiq:admin:token';
  function getToken(){ return localStorage.getItem(tokenKey) || ''; }
  function save(){
    const t = document.getElementById('token').value.trim();
    if(!t) return;
    localStorage.setItem(tokenKey, t);
    load();
  }
  async function api(path, method='GET', body){
    const r = await fetch(path, {
      method,
      headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type':'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if(!r.ok) throw new Error(r.status);
    return r.json();
  }
  async function act(kind, id){
    try { await api('/admin/api/'+kind, 'POST', { device_id: id }); load(); }
    catch(e){ alert('Error: ' + e.message); }
  }
  function esc(s){ return String(s??'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
  async function load(){
    try {
      const st = await api('/admin/api/state');
      document.getElementById('auth-card').style.display='none';
      document.getElementById('content').style.display='block';
      const pend = st.pending.map(p => \`
        <div class="row">
          <div><div class="name">\${esc(p.display_name)}</div>
            <div class="sub">\${esc(p.supabase_user_id||'sin cuenta')}</div>
            <div class="pin">PIN \${esc(p.pin)}</div></div>
          <div style="display:flex;gap:8px">
            <button class="btn-approve" onclick="act('approve','\${esc(p.device_id)}')">Aprobar</button>
            <button class="btn-reject" onclick="act('reject','\${esc(p.device_id)}')">Rechazar</button>
          </div>
        </div>\`).join('') || '<div class="empty">No hay solicitudes.</div>';
      document.getElementById('pending').innerHTML = pend;
      const devs = st.devices.map(d => \`
        <div class="row">
          <div><div class="name">\${esc(d.display_name)}
            \${d.has_cookies ? '<span class="badge yt">YouTube propio</span>' : ''}</div>
            <div class="sub">\${esc(d.supabase_user_id||'sin cuenta')} · \${esc(d.status)}</div></div>
          <div><button class="btn-revoke" onclick="act('revoke','\${esc(d.device_id)}')">Revocar</button></div>
        </div>\`).join('') || '<div class="empty">Sin dispositivos.</div>';
      document.getElementById('devices').innerHTML = devs;
    } catch(e){
      if(String(e.message)==='401'){ localStorage.removeItem(tokenKey); alert('Token inválido'); }
      document.getElementById('auth-card').style.display='block';
      document.getElementById('content').style.display='none';
    }
  }
  if(getToken()) load();
  setInterval(() => { if(getToken() && document.getElementById('content').style.display==='block') load(); }, 8000);
</script>
</body>
</html>`;
