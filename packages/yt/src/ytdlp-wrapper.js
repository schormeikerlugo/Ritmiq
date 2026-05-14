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
 * @param {string} youtubeIdOrUrl
 * @param {YtDlpOpts} [opts]
 * @returns {Promise<string>}
 */
export async function getStreamUrl(youtubeIdOrUrl, opts) {
  const url = normalizeUrl(youtubeIdOrUrl);
  const fmt = 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[acodec^=mp4a]/bestaudio';
  // Flags de aceleración seguras:
  //  --no-check-certificates → skip TLS verification redundante.
  //  --no-warnings → menos stderr ruido.
  //  --skip-download → asegura que solo resuelve URL.
  // NOTA: probamos --extractor-args player_client=ios,android pero esos
  // clientes no exponen el itag m4a que necesita iOS Safari → el selector
  // fallaba con "Requested format is not available". El cliente web por
  // defecto sí los expone; aceptamos el coste de ~2.8s por resolución y
  // priorizamos vía la cola del lan-server.
  const out = await run(
    [
      '-f', fmt,
      '-g',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--skip-download',
      url,
    ],
    opts
  );
  return out.trim().split('\n')[0];
}

/**
 * Obtiene metadata sin descargar.
 * @param {string} youtubeIdOrUrl
 * @param {YtDlpOpts} [opts]
 * @returns {Promise<YtMetadata>}
 */
export async function getMetadata(youtubeIdOrUrl, opts) {
  const url = normalizeUrl(youtubeIdOrUrl);
  const out = await run(['-J', '--no-playlist', url], opts);
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
 * Descarga el audio a un archivo (usa ffmpeg internamente para extraer).
 * @param {string} youtubeIdOrUrl
 * @param {string} outputPath  Ruta sin extensión (yt-dlp añade .opus/.m4a)
 * @param {YtDlpOpts & { format?: 'opus'|'m4a'|'mp3', onProgress?: (pct: number) => void }} [opts]
 * @returns {Promise<void>}
 */
export function downloadAudio(youtubeIdOrUrl, outputPath, opts = {}) {
  const url = normalizeUrl(youtubeIdOrUrl);
  const fmt = opts.format ?? 'opus';
  const bin = opts.binary ?? 'yt-dlp';
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [
      '-x',
      '--audio-format', fmt,
      '--no-playlist',
      '-o', `${outputPath}.%(ext)s`,
      '--newline',
      url,
    ]);
    let stderr = '';
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.stdout.on('data', (b) => {
      const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(b.toString());
      if (m && opts.onProgress) opts.onProgress(parseFloat(m[1]));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited ${code}: ${stderr}`));
    });
  });
}

/** @param {string} idOrUrl */
function normalizeUrl(idOrUrl) {
  if (idOrUrl.startsWith('http')) return idOrUrl;
  return `https://www.youtube.com/watch?v=${idOrUrl}`;
}
