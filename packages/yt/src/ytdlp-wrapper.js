/**
 * Wrapper Node.js para `yt-dlp`. Sólo se usa desde el proceso main de Electron.
 * Asume que el binario `yt-dlp` está en el PATH del sistema. En releases
 * empaquetaremos el binario como recurso de Electron.
 *
 * @module @ritmiq/yt/ytdlp
 */

import { spawn } from 'node:child_process';

/**
 * @typedef {Object} YtMetadata
 * @property {string} id
 * @property {string} title
 * @property {string|null} uploader
 * @property {number|null} duration
 * @property {string|null} thumbnail
 */

/**
 * @typedef {Object} YtDlpOpts
 * @property {string} [binary]    Path al binario yt-dlp. Default: 'yt-dlp'.
 * @property {string} [cookiesFromBrowser]  Si se pasa, añade
 *   `--cookies-from-browser <valor>`. Imprescindible para esquivar el bot
 *   check "Sign in to confirm you're not a bot" que YouTube aplica al
 *   cliente web por defecto desde 2024. **Si `cookiesFile` también está
 *   set, este se ignora** (cookiesFile es más rápido).
 * @property {string} [cookiesFile]  Path a archivo Netscape de cookies
 *   pre-exportado. Evita re-extraer cookies del navegador en cada llamada
 *   (~200-500ms ahorrados). Tiene prioridad sobre `cookiesFromBrowser`.
 * @property {string} [jsRuntime]  Si se pasa, añade `--js-runtimes <valor>`
 *   (p.ej. `'node:/usr/bin/node'` o `'deno'`). **Imprescindible desde
 *   yt-dlp 2025** para resolver signature/n challenges; sin runtime JS,
 *   YouTube devuelve solo storyboards. Auto-detectable con
 *   `detectJsRuntime()` de `main/cookies-detect.js`.
 * @property {boolean} [preferM4a]  Si `true`, selector restrictivo m4a-first
 *   (necesario para PWA iOS Safari). Default `false` — usa `bestaudio` puro,
 *   más permisivo: Electron/Chromium reproduce opus/webm sin problema.
 * @property {string} [cacheDir]  Path persistente para `--cache-dir`. yt-dlp
 *   cachea aquí player.js, JS solvers, etc. Pinneándolo al userData de la
 *   app evita re-descargarlo cada vez que el AppImage monta en una ruta
 *   /tmp distinta. Ahorra 300-1000ms a partir de la 2ª llamada.
 */

/**
 * Ejecuta yt-dlp y devuelve stdout como string.
 * @param {string[]} args
 * @param {YtDlpOpts} [opts]
 * @returns {Promise<string>}
 */
function run(args, opts = {}) {
  const bin = opts.binary ?? 'yt-dlp';
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const promise = new Promise((resolve, reject) => {
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new Error(`yt-dlp killed (${signal})`));
        return;
      }
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp exited ${code}: ${stderr}`));
    });
  });
  // Exponer el handle del proceso para poder matarlo si se cancela.
  promise.kill = () => { try { child.kill('SIGTERM'); } catch {} };
  return promise;
}

/**
 * Resuelve la URL directa del stream de audio (no descarga).
 *
 * Prefiere m4a/AAC porque iOS Safari NO puede decodificar opus/webm.
 * Selector: m4a → mp4 → cualquier audio AAC → fallback a bestaudio.
 *
 * El promise retornado expone `.kill()` que termina el yt-dlp en curso.
 * Necesario para que el LAN server pueda matar prewarms cuando llega un
 * click de alta prioridad (sin esto los 3 slots se mantienen ocupados
 * por los prewarms hasta que terminan ~6s, bloqueando el click).
 *
 * @param {string} youtubeIdOrUrl
 * @param {YtDlpOpts} [opts]
 * @returns {Promise<string> & { kill?: () => void }}
 */
export function getStreamUrl(youtubeIdOrUrl, opts) {
  let currentRun = null;
  let cancelled = false;
  const main = _getStreamUrlImpl(youtubeIdOrUrl, opts, {
    setCurrent: (r) => { currentRun = r; },
    isCancelled: () => cancelled,
  });
  main.kill = () => {
    cancelled = true;
    try { currentRun?.kill?.(); } catch {}
  };
  return main;
}

async function _getStreamUrlImpl(youtubeIdOrUrl, opts, ctx) {
  const url = normalizeUrl(youtubeIdOrUrl);
  // Selector m4a-first (para PWA iOS) o bestaudio puro (Electron/Chromium).
  // En Electron usamos `bestaudio` porque Chromium decodifica opus/webm
  // sin drama, y el selector m4a-first falla con "Requested format is not
  // available" en clients alternativos que necesitamos para evadir bot check.
  const fmt = opts?.preferM4a
    ? 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[acodec^=mp4a]/bestaudio'
    : 'bestaudio';
  // Preferir cookies-file (instantáneo) sobre cookies-from-browser
  // (lento: 200-500ms por re-extracción).
  const cookieArgs = opts?.cookiesFile
    ? ['--cookies', opts.cookiesFile]
    : opts?.cookiesFromBrowser
      ? ['--cookies-from-browser', opts.cookiesFromBrowser]
      : [];
  const jsRuntimeArgs = opts?.jsRuntime
    ? ['--js-runtimes', opts.jsRuntime]
    : [];
  const cacheArgs = opts?.cacheDir ? ['--cache-dir', opts.cacheDir] : [];
  const baseArgs = [
    '-g',
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--skip-download',
    // Tier 1 speed flags — ver `docs/playback-troubleshooting.md`.
    // NOTA: yt-dlp NO acepta `--lazy-extractors` (extractors ya son lazy
    // por defecto desde hace años). No reintroducir.
    '--no-mark-watched',     // ~50ms — no llamamos a YouTube de vuelta
    '--no-call-home',        // ~50ms — sin telemetría a github
    ...cacheArgs,            // cache persistente de player.js / JS solvers
    ...jsRuntimeArgs,
  ];

  /**
   * @param {string} f
   * @param {string|null} client
   * @param {boolean} useCookies  Si false, omite cookies aunque estén
   *   configuradas. Necesario para clients sin soporte de cookies
   *   (android_vr) que yt-dlp salta silenciosamente cuando hay `--cookies-from-browser`.
   */
  const build = (f, client, useCookies = true) => {
    const a = ['-f', f, ...baseArgs];
    if (useCookies) a.push(...cookieArgs);
    // `skip=dash,hls` evita parsear manifests alternativos (sólo nos
    // interesa audio progresivo). Combinable con player_client en la
    // misma flag `--extractor-args` separando con `;`.
    const xargs = client
      ? `youtube:player_client=${client};skip=dash,hls`
      : 'youtube:skip=dash,hls';
    a.push('--extractor-args', xargs);
    a.push(url);
    return a;
  };

  // ═════════════════════════════════════════════════════════════════════
  // CASCADA DE PLAYER_CLIENTS — Anti-bot + signature solving (2025+)
  // ═════════════════════════════════════════════════════════════════════
  //
  // ⚠️ MANTENIMIENTO: si la reproducción se rompe con uno de estos errores,
  // REVISA ESTA CASCADA antes de tocar otra cosa:
  //
  //   • "Requested format is not available" (incluso con -f bestaudio)
  //   • "Signature solving failed" / "n challenge solving failed"
  //   • "Sign in to confirm you're not a bot"
  //   • "Only images are available for download" (solo storyboards)
  //   • "Skipping client X since it does not support cookies"
  //
  // ── Por qué esta orden (2026-05) ─────────────────────────────────────
  //
  // yt-dlp 2025+ exige un runtime JavaScript (Deno o Node) para resolver
  // las firmas cifradas de URL de YouTube. Sin runtime JS, la mayoría de
  // clients devuelven SOLO storyboards (imágenes).
  //
  // PARADOJA CRÍTICA descubierta empíricamente:
  //   • CON cookies + cliente "android_vr" → yt-dlp salta android_vr
  //     porque "no soporta cookies", cae a clients web → fallan sin JS.
  //   • SIN cookies + cliente "android_vr" → YouTube devuelve 429 / bot check.
  //   • CON cookies + JS runtime + cliente normal → ✅ FUNCIONA.
  //
  // Por eso la estrategia óptima cambia según haya o no JS runtime:
  //
  //   A. SI hay JS runtime (deno o node): usar clients normales
  //      (default/web_safari/tv_embedded/mweb) CON cookies. Pueden
  //      resolver signatures → URLs reales de googlevideo.
  //
  //   B. SI NO hay JS runtime: caer a `android_vr` / `ios_music` SIN
  //      cookies. Es el único path que no requiere signature solving.
  //      Menos fiable porque YouTube puede tirar 429 sin cookies, pero
  //      es el último recurso.
  //
  // ── Diagnóstico cuando algo falle ─────────────────────────────────────
  //
  //   1. Verifica versión yt-dlp (debe ser < 30 días):
  //      $ <bin> --version
  //
  //   2. Replicar exactamente lo que hace la app (con JS runtime):
  //      $ <bin> --cookies-from-browser firefox \
  //          --js-runtimes node:/usr/bin/node \
  //          --extractor-args "youtube:player_client=default" \
  //          -F "https://www.youtube.com/watch?v=<ID>"
  //
  //   3. Si "Skipping unsupported client X" o "Skipping client X since
  //      it does not support cookies" → mira la cascada y reordena.
  //
  // Ver `docs/playback-troubleshooting.md` para más planes (PO Token,
  // youtubei.js, etc.).
  //
  // ── Cascada actual ───────────────────────────────────────────────────
  const hasJs = Boolean(opts?.jsRuntime);
  const attempts = hasJs
    ? [
        // CON JS runtime: clients normales pueden resolver signatures.
        // Mantenemos cookies para esquivar bot check.
        { fmt, client: 'default',     useCookies: true  },
        { fmt, client: 'web_safari',  useCookies: true  },
        { fmt, client: 'mweb',        useCookies: true  },
        { fmt, client: 'tv_embedded', useCookies: true  },
        // Fallback final si lo de arriba falla por formato:
        { fmt: 'bestaudio', client: null, useCookies: true },
        // Último recurso: android_vr SIN cookies (yt-dlp lo skip-ea si las hay).
        { fmt, client: 'android_vr',  useCookies: false },
        { fmt, client: 'ios_music',   useCookies: false },
      ]
    : [
        // SIN JS runtime: SOLO los clients que no necesitan signature solving.
        // Hay que ir SIN cookies (yt-dlp salta android_vr si las pasamos).
        { fmt, client: 'android_vr',  useCookies: false },
        { fmt, client: 'ios_music',   useCookies: false },
        // Intento desesperado con cookies por si algún client raro funciona:
        { fmt, client: 'mweb',        useCookies: true  },
        { fmt: 'bestaudio', client: null, useCookies: true },
      ];

  let lastErr;
  for (const a of attempts) {
    if (ctx?.isCancelled?.()) throw new Error('cancelled');
    try {
      const r = run(build(a.fmt, a.client, a.useCookies ?? true), opts);
      ctx?.setCurrent?.(r);
      const out = await r;
      return out.trim().split('\n')[0];
    } catch (err) {
      lastErr = err;
      if (ctx?.isCancelled?.()) throw new Error('cancelled');
      const msg = err?.message ?? '';
      const retryable =
        /Requested format is not available/i.test(msg) ||
        /Sign in to confirm/i.test(msg) ||
        /player_client/i.test(msg) ||
        /This video is not available/i.test(msg) ||
        /Only images are available/i.test(msg) ||      // signature solving falló
        /Signature solving failed/i.test(msg) ||
        /n challenge/i.test(msg);
      if (!retryable) throw err;
    }
  }
  throw lastErr;
}

/**
 * Obtiene metadata sin descargar.
 * @param {string} youtubeIdOrUrl
 * @param {YtDlpOpts} [opts]
 * @returns {Promise<YtMetadata>}
 */
export async function getMetadata(youtubeIdOrUrl, opts) {
  const url = normalizeUrl(youtubeIdOrUrl);
  const args = [
    '-J',
    '--no-playlist',
    '--no-warnings',
    '--no-mark-watched',
    '--no-call-home',
    // Mismo orden que la cascada de getStreamUrl — ver comentario allí.
    // `skip=dash,hls` evita manifests alternativos (no los usamos).
    '--extractor-args', 'youtube:player_client=default,web_safari,mweb,tv_embedded,android_vr,ios_music;skip=dash,hls',
  ];
  if (opts?.cacheDir) args.push('--cache-dir', opts.cacheDir);
  if (opts?.jsRuntime) args.push('--js-runtimes', opts.jsRuntime);
  if (opts?.cookiesFile) args.push('--cookies', opts.cookiesFile);
  else if (opts?.cookiesFromBrowser) args.push('--cookies-from-browser', opts.cookiesFromBrowser);
  args.push(url);
  const out = await run(args, opts);
  const j = JSON.parse(out);
  return {
    id: j.id,
    title: j.title,
    uploader: j.uploader ?? null,
    duration: j.duration ?? null,
    thumbnail: pickThumb(j),
  };
}

/**
 * Búsqueda orgánica en YouTube usando `ytsearchN:<query>` de yt-dlp.
 * Devuelve metadata ligera (sin extraer streams, mucho más rápido).
 *
 * @param {string} query
 * @param {YtDlpOpts & { max?: number }} [opts]
 * @returns {Promise<YtMetadata[]>}
 */
export async function search(query, opts = {}) {
  const max = opts.max ?? 10;
  const out = await run(
    [
      `ytsearch${max}:${query}`,
      '--flat-playlist',
      '--dump-json',
      '--no-warnings',
      '--skip-download',
    ],
    opts
  );
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  /** @type {YtMetadata[]} */
  const results = [];
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      results.push({
        id: j.id,
        title: j.title,
        uploader: j.uploader ?? j.channel ?? null,
        duration: j.duration ?? null,
        thumbnail: pickThumb(j),
      });
    } catch {
      /* ignorar líneas no-JSON */
    }
  }
  return results;
}

/** @param {any} j */
function pickThumb(j) {
  if (j.thumbnail) return j.thumbnail;
  const arr = j.thumbnails;
  if (Array.isArray(arr) && arr.length) {
    // mejor disponible
    return arr[arr.length - 1].url ?? null;
  }
  return null;
}

/**
 * Descarga el audio a un archivo.
 *
 * Para `format='m4a'` (usado por el LAN server compartido) usamos un
 * format selector DIRECTO (`ba[ext=m4a]`) sin `-x`. Esto evita pasar
 * por ffmpeg para transcodificar:
 *   - Velocidad: 22s -> ~3-5s para 4MB porque no hay transcoding.
 *   - Bytes consistentes con el proxy: googlevideo sirve el m4a tal cual,
 *     y nosotros guardamos el MISMO archivo. Sin esto, los bytes del
 *     proxy (m4a original) NO coinciden con los del archivo en disco
 *     (m4a transcodificado por ffmpeg) y Safari falla a decodificar
 *     cuando una range request salta del proxy al archivo cacheado:
 *     sintoma observable = la cancion arranca en silencio y solo suena
 *     tras pause+play (que fuerza re-fetch desde 0 contra el archivo).
 *
 * Para `opus`/`mp3` mantenemos `-x` porque siempre requieren conversion
 * (la web no sirve mp3 puro, y el opus en YouTube viene en webm que no
 * siempre tiene tags utiles).
 *
 * @param {string} youtubeIdOrUrl
 * @param {string} outputPath  Ruta sin extensión (yt-dlp añade .opus/.m4a)
 * @param {YtDlpOpts & { format?: 'opus'|'m4a'|'mp3', onProgress?: (pct: number) => void }} [opts]
 * @returns {Promise<string>}  Path real escrito (con extension real).
 */
export function downloadAudio(youtubeIdOrUrl, outputPath, opts = {}) {
  const url = normalizeUrl(youtubeIdOrUrl);
  const fmt = opts.format ?? 'opus';
  const bin = opts.binary ?? 'yt-dlp';
  return new Promise((resolve, reject) => {
    /** @type {string[]} */
    const dlArgs = [];
    if (fmt === 'm4a') {
      // Path rapido: descarga directa del stream m4a SIN transcoding ni
      // remux. Usamos EL MISMO selector que `getStreamUrl(preferM4a=true)`
      // para asegurar que ambos eligen el mismo `format_id` y los bytes
      // coinciden — critico para que las range requests del proxy live
      // y del archivo cacheado entreguen contenido identico a Safari.
      dlArgs.push(
        '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[acodec^=mp4a]/bestaudio',
        '--no-playlist',
        '-o', `${outputPath}.%(ext)s`,
      );
    } else {
      // opus/mp3: extraccion via ffmpeg (transcoding inevitable).
      dlArgs.push(
        '-x',
        '--audio-format', fmt,
        '--no-playlist',
        '-o', `${outputPath}.%(ext)s`,
      );
    }
    dlArgs.push(
      '--newline',
      '--no-mark-watched',
      '--no-call-home',
      '--extractor-args', 'youtube:player_client=default,web_safari,mweb,tv_embedded,android_vr,ios_music',
    );
    if (opts.cacheDir) dlArgs.push('--cache-dir', opts.cacheDir);
    if (opts.jsRuntime) dlArgs.push('--js-runtimes', opts.jsRuntime);
    if (opts.cookiesFile) dlArgs.push('--cookies', opts.cookiesFile);
    else if (opts.cookiesFromBrowser) dlArgs.push('--cookies-from-browser', opts.cookiesFromBrowser);
    dlArgs.push(url);
    const child = spawn(bin, dlArgs);
    let stderr = '';
    let stdout = '';
    /** @type {string|null} */
    let destination = null;
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.stdout.on('data', (b) => {
      const s = b.toString();
      stdout += s;
      const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(s);
      if (m && opts.onProgress) opts.onProgress(parseFloat(m[1]));
      // yt-dlp imprime "[download] Destination: <path>" — capturamos para
      // saber la ruta final real (la extension depende del format elegido).
      const dm = /\[(?:download|ExtractAudio)\]\s+(?:Destination|Adding metadata to):\s*(.+)$/m.exec(s);
      if (dm) destination = dm[1].trim();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited ${code}: ${stderr}`));
        return;
      }
      if (destination) { resolve(destination); return; }
      // Fallback: heuristica — si quedo `.<algo>`, lo encontramos via fs.
      resolve(`${outputPath}.${fmt}`);
    });
  });
}

/** @param {string} idOrUrl */
function normalizeUrl(idOrUrl) {
  if (idOrUrl.startsWith('http')) return idOrUrl;
  return `https://www.youtube.com/watch?v=${idOrUrl}`;
}
