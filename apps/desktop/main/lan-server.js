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
import { app } from 'electron';
import { Bonjour } from 'bonjour-service';
import { getStreamUrl, getMetadata, search, downloadAudio } from '@ritmiq/yt/ytdlp';
import {
  findSharedAudio, registerSharedAudio,
  sharedAudioStats, clearSharedAudio,
} from '@ritmiq/db/sqlite';
import {
  createPairRequest, getPairStatus, findDeviceByToken,
  updateDeviceCookies, logActivity, pruneOldActivity,
} from './devices.js';
import { encryptCookies, getCookieFileForDevice, invalidateDeviceCookies } from './device-cookies.js';
import { getYtDlpPath } from './ytdlp-path.js';
import { detectCookiesBrowser, detectJsRuntime, exportCookiesToFile } from './cookies-detect.js';

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
 */
export async function startLanServer({ port, db, accessToken }) {
  const ytBinary = getYtDlpPath();
  const cookiesFromBrowser = detectCookiesBrowser();
  const jsRuntime = detectJsRuntime();
  // Modelo Y (Fase 4+): la autorizacion es device_token, no HMAC. El
  // signing-secret y ACCEPT_UNSIGNED ya no se usan aqui.

  /**
   * Devuelve opciones de yt-dlp para un request concreto. Si el caller
   * autorizo con device_token y el device tiene cookies subidas, las
   * usamos. Si no, fallback a las cookies del owner.
   *
   * @param {{ owner: true } | import('./devices.js').DeviceRow | null} principal
   */
  function ytOptsFor(principal) {
    if (principal && principal.owner !== true) {
      const file = getCookieFileForDevice(principal);
      if (file) return { ...ytOpts, cookiesFile: file, cookiesFromBrowser: undefined };
    }
    return ytOpts;
  }
  // Cache persistente para yt-dlp (player.js, JS solvers, etc.). Sin esto
  // el AppImage monta en /tmp distinto cada arranque → yt-dlp re-descarga
  // 3-5MB de player.js cada vez. Pinneamos en userData.
  const cacheDir = join(app.getPath('userData'), 'yt-dlp-cache');
  try { mkdirSync(cacheDir, { recursive: true }); } catch {}
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
  const ytOpts = {
    binary: ytBinary,
    cookiesFromBrowser: cookiesFromBrowser ?? undefined,
    cookiesFile: undefined,
    jsRuntime: jsRuntime ?? undefined,
    cacheDir,
    // m4a/AAC obligatorio: el LAN server sirve también al PWA (iOS Safari)
    // que NO decodifica opus/webm. Síntoma característico: la barra avanza
    // pero NO se escucha audio. Selector cae a `bestaudio` puro si m4a no
    // está disponible para ese vídeo concreto. Electron/Chromium reproduce
    // m4a sin problema, así que lo dejamos global.
    preferM4a: true,
  };
  if (cookiesFromBrowser) {
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
   * Extrae el Bearer token (o ?token=) del request.
   * @returns {string|null}
   */
  function extractBearer(req, url) {
    const auth = req.headers['authorization'];
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    const qsToken = url.searchParams.get('token');
    return qsToken || null;
  }

  /**
   * Owner-only auth: el access-token unico del PC. Para endpoints
   * administrativos (shared-cache clear, etc.). Si accessToken no esta
   * configurado, deja pasar (modo dev abierto).
   */
  function isOwner(req, url) {
    if (!accessToken) return true;
    return extractBearer(req, url) === accessToken;
  }

  /**
   * Device-or-owner auth: acepta tanto el access-token del owner (uso
   * desde la app desktop misma o herramientas) como un device_token
   * aprobado. Devuelve la fila del device si autorizo via token de
   * device, o un objeto sentinel { owner: true } si fue el owner.
   *
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
   * Compat: usado por endpoints viejos /yt/search etc. que aun no
   * migraron al modelo device_token. Acepta access-token solo. En
   * Fase 4 estos endpoints pasaran a usar `authorizeDeviceOrOwner`.
   */
  function isAuthorized(req, url) {
    if (!accessToken) return true;
    return extractBearer(req, url) === accessToken;
  }

  // ── Rate limit en pareo ─────────────────────────────────────────────
  // Por IP: max 5 requests por minuto. Sin esto, alguien con la tunnel
  // URL puede flood-ear /pair y llenar la cola de solicitudes.
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

  // ── Notificacion al owner de nuevas pair requests ──────────────────
  // El renderer del desktop se suscribe via IPC para mostrar UI en vivo.
  /** @type {Set<(req: { deviceId:string, displayName:string, pin:string }) => void>} */
  const pairListeners = new Set();
  function notifyOwnerNewPairRequest(payload) {
    for (const cb of pairListeners) { try { cb(payload); } catch {} }
  }
  // Activity log rotation al arrancar y cada 12h.
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
  const sharedAudioDir = join(app.getPath('userData'), 'shared-audio');
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
  async function downloadSharedAudio(ytId, dlOpts = ytOpts) {
    const existing = findSharedAudio(db, ytId);
    if (existing) return existing.filePath;

    const inflight = inflightDownloads.get(ytId);
    if (inflight) return inflight;

    const promise = (async () => {
      const outBase = join(sharedAudioDir, ytId);
      const t0 = Date.now();
      console.log(`[lan-server] download ${ytId} START`);
      const finalPath = await downloadAudio(ytId, outBase, {
        ...dlOpts,
        // m4a obligatorio: la PWA en iOS Safari no decodifica opus/webm.
        // El nuevo path (sin -x) descarga el m4a directo de googlevideo
        // sin transcoding: rapido + bytes consistentes con el proxy.
        format: 'm4a',
      });
      let size = 0;
      try { size = statSync(finalPath).size; } catch {}
      const mime = finalPath.endsWith('.opus') ? 'audio/ogg'
                 : finalPath.endsWith('.mp3')  ? 'audio/mpeg'
                 : 'audio/mp4';
      registerSharedAudio(db, { ytId, filePath: finalPath, mime, size });
      console.log(`[lan-server] download ${ytId} OK en ${Date.now() - t0}ms (${size} bytes, ${finalPath.split('.').pop()})`);
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
   * @param {object} [optsOverride]  ytOpts a usar si no hay cache hit.
   *   Util para usar cookies del device que pidio el stream en lugar
   *   de las globales del owner.
   */
  function resolveCached(ytId, priority = 1, optsOverride = null) {
    const now = Date.now();
    const hit = streamCache.get(ytId);
    if (hit) {
      if (hit.url && hit.expiresAt > now) {
        // Cache hits son muy frecuentes (Safari hace ~6 range requests
        // por track). No logueamos cada uno para no inundar la consola;
        // un log unico se imprime cuando MISS (yt-dlp arranca).
        return Promise.resolve(hit.url);
      }
      if (hit.inflight) {
        console.log(`[lan-server] resolve ${ytId} INFLIGHT (esperando, p=${priority})`);
        // Si la prioridad subió (de prewarm a stream real), promover en cola
        // si aún no empezó.
        const queued = waitQueue.find((j) => j.ytId === ytId);
        if (queued && priority > queued.priority) queued.priority = priority;
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
          const cp = getStreamUrl(ytId, optsOverride ?? ytOpts);
          job.childPromise = cp;
          const url = await cp;
          const dt = Date.now() - t0;
          console.log(`[lan-server] resolve ${ytId} OK en ${dt}ms`);
          streamCache.set(ytId, { url, expiresAt: Date.now() + TTL_MS });
          resolveFn(url);
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

      // Pareo: rutas PUBLICAS — la PWA aun no tiene token. Procesamos
      // antes del check de auth para no rechazar legitimas solicitudes.
      if (url.pathname === '/pair' || url.pathname === '/pair/status') {
        // Handler real esta mas abajo (cerca del codigo existente). Caemos
        // a traves: ese handler lo procesa.
      } else if (!authorizeDeviceOrOwner(req, url)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (url.pathname === '/yt/search') {
        const q = url.searchParams.get('q');
        if (!q) { res.writeHead(400).end('q required'); return; }
        const principal = authorizeDeviceOrOwner(req, url);
        const opts = ytOptsFor(principal);
        const items = await search(q, { ...opts, max: 12 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items }));
        for (const it of items.slice(0, 2)) {
          if (it?.id) resolveCached(it.id, 1, opts).catch(() => {});
        }
        if (principal && principal.owner !== true) {
          logActivity(db, { deviceId: principal.device_id, action: 'search', meta: { q } });
        }
        return;
      }

      // Permite al cliente "calentar" el cache antes de pulsar play.
      // Prioridad MEDIA — el usuario ya mostró intención (touch/hover sobre
      // el resultado), pero todavía no es un stream comprometido.
      if (url.pathname === '/yt/prewarm') {
        const ytId = url.searchParams.get('q');
        if (!ytId) { res.writeHead(400).end('q required'); return; }
        const principal = authorizeDeviceOrOwner(req, url);
        resolveCached(ytId, 5, ytOptsFor(principal)).catch(() => {});
        res.writeHead(204).end();
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
        const principal = authorizeDeviceOrOwner(req, url);
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

      // ─── Pairing: solicitudes y polling de estado ─────────────────────
      // Endpoints PUBLICOS (sin Bearer) por necesidad: la PWA aun no
      // tiene token cuando pide pareo. Rate limit por IP mitiga abuso.
      // POST /pair: { device_id, display_name, supabase_user_id?, pin, cookies_b64? }
      //   -> { status: 'approved'|'pending', device_token? }
      // GET  /pair/status?device_id=X -> { status, device_token? }
      if (url.pathname === '/pair') {
        if (req.method !== 'POST') {
          res.writeHead(405).end('method not allowed');
          return;
        }
        const ip = clientIpOf(req);
        if (!pairRateLimit(ip)) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'too many pairing attempts, wait a minute' }));
          return;
        }
        let body;
        try { body = await readJsonBody(req); }
        catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid json' }));
          return;
        }
        const { device_id, display_name, supabase_user_id, pin, cookies_b64 } = body ?? {};
        if (!device_id || !display_name || !pin || !/^\d{4}$/.test(String(pin))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'device_id, display_name and 4-digit pin required' }));
          return;
        }
        const cookiesBlob = cookies_b64 ? Buffer.from(String(cookies_b64), 'base64') : null;
        try {
          const r = createPairRequest(db, {
            deviceId: String(device_id),
            displayName: String(display_name).slice(0, 80),
            supabaseUserId: supabase_user_id ? String(supabase_user_id) : null,
            pin: String(pin),
            cookiesBlob,
            clientIp: ip,
          });
          if (r.status === 'approved') {
            logActivity(db, { deviceId: String(device_id), action: 'pair_auto_approved' });
            console.log(`[lan-server] pair AUTO-APPROVED ${display_name} (${device_id})`);
          } else {
            console.log(`[lan-server] pair REQUEST ${display_name} (${device_id}) pin=${pin}`);
            notifyOwnerNewPairRequest({ deviceId: String(device_id), displayName: String(display_name), pin: String(pin) });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: r.status,
            device_token: r.deviceToken,
          }));
        } catch (err) {
          console.error('[lan-server] /pair error', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message ?? 'pair failed' }));
        }
        return;
      }

      if (url.pathname === '/pair/status') {
        if (req.method !== 'GET') {
          res.writeHead(405).end('method not allowed');
          return;
        }
        const deviceId = url.searchParams.get('device_id');
        if (!deviceId) {
          res.writeHead(400).end('device_id required');
          return;
        }
        const r = getPairStatus(db, deviceId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: r.status,
          device_token: r.deviceToken,
          display_name: r.displayName,
        }));
        return;
      }

      // ─── Cookies upload por device ─────────────────────────────────────
      // POST /cookies/upload  { cookies_b64 }
      // Auth: device_token (no aceptamos access-token owner aqui — el
      // owner sube sus cookies via la app desktop si quiere).
      if (url.pathname === '/cookies/upload') {
        if (req.method !== 'POST') { res.writeHead(405).end('method not allowed'); return; }
        const principal = authorizeDeviceOrOwner(req, url);
        if (!principal || principal.owner === true) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'device_token required' }));
          return;
        }
        let body;
        try { body = await readJsonBody(req); }
        catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid json' }));
          return;
        }
        const text = body?.cookies_b64
          ? Buffer.from(String(body.cookies_b64), 'base64').toString('utf8')
          : (body?.cookies ?? '');
        if (!text || text.length < 50) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'cookies content too short' }));
          return;
        }
        try {
          const blob = encryptCookies(text);
          updateDeviceCookies(db, principal.device_id, blob);
          invalidateDeviceCookies(principal.device_id);
          logActivity(db, { deviceId: principal.device_id, action: 'cookies_upload', meta: { size: text.length } });
          console.log(`[lan-server] cookies updated for device ${principal.device_id} (${text.length} bytes)`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message ?? 'cookies upload failed' }));
        }
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
          const r = clearSharedAudio(db, sharedAudioDir);
          console.log(
            `[lan-server] shared-cache clear: ${r.removed} files, ${r.freedBytes} bytes` +
            (r.preserved > 0 ? ` (preserved ${r.preserved} owner files)` : '')
          );
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
        const principalForDl = authorizeDeviceOrOwner(req, url);
        const localRow = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);
        const ytId = url.searchParams.get('yt') || localRow?.yt_id || null;
        if (!ytId) {
          res.writeHead(404).end('source unavailable (no ytId)');
          return;
        }
        const cached = findSharedAudio(db, ytId);
        if (cached) {
          console.log(`[lan-server] download ${ytId} CACHE HIT`);
          if (principalForDl && principalForDl.owner !== true) {
            logActivity(db, { deviceId: principalForDl.device_id, action: 'download_cached', trackId, ytId });
          }
          return serveLocalFile(req, res, cached.filePath);
        }
        try {
          const filePath = await downloadSharedAudio(ytId, ytOptsFor(principalForDl));
          if (principalForDl && principalForDl.owner !== true) {
            logActivity(db, { deviceId: principalForDl.device_id, action: 'download', trackId, ytId });
          }
          return serveLocalFile(req, res, filePath);
        } catch (err) {
          console.warn(`[lan-server] download ${ytId} FAIL`, err.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message ?? 'download failed' }));
          return;
        }
      }

      if (url.pathname.startsWith('/stream/')) {
        const trackId = decodeURIComponent(url.pathname.slice('/stream/'.length));
        const principalForStream = authorizeDeviceOrOwner(req, url);

        // SEGURIDAD: el endpoint `/stream/yt:<ytId>` (que permitia pedir
        // CUALQUIER ytId sin atadura a una row de track) fue eliminado en
        // Fase 4 — convertia el desktop en proxy abierto de YouTube. Para
        // tracks efimeros usa /stream/<trackId>?yt=<ytId> con device_token.

        // Modelo Y: autorizacion ya validada arriba via authorizeDeviceOrOwner.
        // Resolvemos el ytId en este orden:
        //   1. SQLite local (track descargado por owner) -> archivo.
        //   2. ?yt=<ytId> de la URL (PWA del device lo conoce).
        //   3. shared_audio (alguien ya descargo este ytId) -> archivo.
        //   4. yt-dlp resolve -> proxy live.
        const localRow = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);
        if (localRow?.is_downloaded && localRow.file_path && existsSync(localRow.file_path)) {
          return serveLocalFile(req, res, localRow.file_path);
        }
        const ytId = url.searchParams.get('yt') || localRow?.yt_id || null;
        if (!ytId) {
          res.writeHead(404).end('source unavailable (no ytId)');
          return;
        }
        const shared = findSharedAudio(db, ytId);
        if (shared) {
          console.log(`[lan-server] stream ${trackId} SHARED HIT ytId=${ytId}`);
          if (principalForStream && principalForStream.owner !== true) {
            logActivity(db, { deviceId: principalForStream.device_id, action: 'stream_shared', trackId, ytId });
          }
          return serveLocalFile(req, res, shared.filePath);
        }
        const streamUrl = await resolveCached(ytId, 10, ytOptsFor(principalForStream));
        if (principalForStream && principalForStream.owner !== true) {
          logActivity(db, { deviceId: principalForStream.device_id, action: 'stream', trackId, ytId });
        }
        // OPTIMIZACION: arranca descarga en background. Safari abre 6+
        // range requests paralelos para un mismo archivo; mientras la
        // primera se proxia desde googlevideo, yt-dlp baja el m4a
        // entero al disco (paralelo HTTP, ~2-5s). Las range requests
        // subsiguientes encuentran SHARED HIT y se sirven desde disco
        // a velocidad LAN — orden de magnitud mas rapido y sin riesgo
        // de ConnectTimeout a googlevideo.
        downloadSharedAudio(ytId, ytOptsFor(principalForStream)).catch((err) => {
          // No es fatal — el proxy en vivo sigue funcionando. Solo
          // perdemos la optimizacion de cache.
          console.warn(`[lan-server] background download ${ytId} failed:`, err.message);
        });
        return proxyAudio(req, res, streamUrl);
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
    stop: async () => {
      try { advert?.stop?.(); } catch {}
      try { bonjour?.destroy(); } catch {}
      await new Promise((r) => server.close(r));
    },
    /**
     * Suscripcion a eventos "nueva pair request". El renderer la usa
     * para mostrar UI en vivo y notificacion nativa.
     */
    onPairRequest: (cb) => {
      pairListeners.add(cb);
      return () => pairListeners.delete(cb);
    },
  };
}

/**
 * Lee un body JSON con limite de tamaño (256 KB). Cookies son ~50KB
 * realistas; mas que eso huele a abuso.
 * @param {http.IncomingMessage} req
 */
async function readJsonBody(req) {
  const MAX_BYTES = 256 * 1024;
  return new Promise((resolve, reject) => {
    let total = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        req.destroy(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const txt = Buffer.concat(chunks).toString('utf8');
        resolve(txt ? JSON.parse(txt) : {});
      } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

/**
 * IP del cliente, respetando X-Forwarded-For si viene del tunnel.
 * Cloudflare manda CF-Connecting-IP que es la mas fiable.
 * @param {http.IncomingMessage} req
 */
function clientIpOf(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf);
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress ?? '';
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

  // Fetch con retry: googlevideo a veces da ConnectTimeoutError (10s
  // default de undici) cuando hay muchas conexiones paralelas a un
  // mismo CDN node. Reintentamos una vez con timeout extendido (20s)
  // y un small backoff. Si tambien falla el retry, devolvemos 502.
  let upstream;
  try {
    upstream = await fetchWithRetry(upstreamUrl, headers);
  } catch (err) {
    console.warn(`[lan-server] proxy fetch failed: ${err.message ?? err}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream fetch failed' }));
    } else {
      res.end();
    }
    return;
  }

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
  nodeStream.on('error', (err) => {
    console.warn('[lan-server] proxy stream error', err.message);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  // Si el cliente cierra, abortamos el upstream
  res.on('close', () => nodeStream.destroy());
  nodeStream.pipe(res);
}

/**
 * fetch con un solo reintento ante ConnectTimeoutError o ECONNRESET.
 * undici tiene connect timeout default 10s — googlevideo a veces tarda
 * mas cuando esta saturado por muchas conexiones paralelas. Subimos el
 * timeout a 20s y reintentamos una vez antes de devolver 502.
 *
 * @param {string} url
 * @param {Record<string,string>} headers
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, headers) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      const transient =
        err?.name === 'AbortError' ||
        err?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        err?.code === 'ECONNRESET' ||
        err?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        err?.cause?.code === 'ECONNRESET';
      if (attempt === 0 && transient) {
        console.warn(`[lan-server] fetch retry (${err?.cause?.code ?? err?.code ?? err?.name})`);
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      throw err;
    }
  }
  throw new Error('fetchWithRetry: unreachable');
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
