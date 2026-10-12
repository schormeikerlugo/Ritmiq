/**
 * Descarga progresiva compartida de audio de googlevideo.
 *
 * Problema que resuelve (2026-10): en cache-miss el servidor abría un proxy
 * NUEVO a googlevideo por cada Range que pide Safari (20+ por canción en iOS,
 * 1-5s de primer byte cada uno) y además lanzaba en paralelo una descarga
 * yt-dlp que compartía el mismo `<id>.m4a.part` que el tee del proxy. Cuando
 * Safari cerraba un rango, el tee borraba ese `.part` → yt-dlp fallaba al
 * renombrar → la canción nunca quedaba en disco y cada repetición volvía a
 * YouTube (solo el 23% de los streams salía de disco con 87% de repeticiones).
 *
 * Ahora hay UNA descarga por ytId hacia un `.part` propio, y todos los Range
 * del cliente se sirven desde ese archivo mientras crece. Al terminar se
 * renombra a `<id>.m4a` y se registra como shared audio.
 *
 * Sin dependencias de SQLite: testeable en aislamiento (ver
 * progressive-audio.test.js).
 *
 * @module @ritmiq/server-core/progressive-audio
 */

import { open, rename, unlink } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
// googlevideo estrangula conexiones lineales largas; pedir por bloques (como
// yt-dlp --http-chunk-size 10M). Una canción típica (~4MB) cabe en uno.
const CHUNK_BYTES = 10 * 1024 * 1024;
// Si el cliente pide un rango más allá de lo descargado + este margen (seek
// lejano), se sirve con un proxy directo de ese rango en vez de esperar.
const FAR_SEEK_BYTES = 1024 * 1024;
const READ_BYTES = 64 * 1024;
const STALL_MS = 20_000;

/**
 * @typedef {Object} ProgressiveEntry
 * @property {string} ytId
 * @property {string} url            URL vigente de googlevideo.
 * @property {string} partPath
 * @property {string} finalPath
 * @property {number|null} total     Tamaño total (null hasta el 1er bloque).
 * @property {string} contentType
 * @property {number} written        Bytes escritos contiguos desde 0.
 * @property {boolean} done
 * @property {Error|null} error
 * @property {Promise<void>} ready   Resuelve cuando se conoce `total`.
 * @property {Promise<string>} finished  Resuelve con finalPath al completar.
 */

/**
 * @param {Object} opts
 * @param {string} opts.dir                 Carpeta shared-audio.
 * @param {number} [opts.firstByteTimeoutMs] Timeout de cabeceras por bloque.
 * @param {(e: ProgressiveEntry) => void} [opts.onComplete]
 * @param {typeof fetch} [opts.fetchImpl]   Inyectable para tests.
 */
export function createProgressiveAudio({ dir, firstByteTimeoutMs = 4000, onComplete, fetchImpl = fetch }) {
  /** @type {Map<string, ProgressiveEntry>} */
  const entries = new Map();

  async function fetchRange(url, start, end) {
    const ac = new AbortController();
    let timer = setTimeout(() => ac.abort(), firstByteTimeoutMs);
    const resp = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Range: `bytes=${start}-${end}` },
      signal: ac.signal,
    }).finally(() => clearTimeout(timer));
    // Vigilancia de cuerpo estancado: abortar si no llegan bytes en STALL_MS.
    const kick = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ac.abort(), STALL_MS);
    };
    return { resp, kick, stop: () => clearTimeout(timer) };
  }

  async function run(entry, onUpstreamDead) {
    const fh = await open(entry.partPath, 'w');
    try {
      let retriedDead = false;
      while (entry.total === null || entry.written < entry.total) {
        const start = entry.written;
        const end = entry.total === null
          ? start + CHUNK_BYTES - 1
          : Math.min(start + CHUNK_BYTES, entry.total) - 1;
        let { resp, kick, stop } = await fetchRange(entry.url, start, end);
        if ([401, 403, 410].includes(resp.status) && onUpstreamDead && !retriedDead) {
          // URL caducada: re-resolver una vez y reintentar el bloque.
          stop();
          retriedDead = true;
          entry.url = await onUpstreamDead();
          ({ resp, kick, stop } = await fetchRange(entry.url, start, end));
        }
        if (resp.status !== 206 && resp.status !== 200) {
          stop();
          throw new Error(`upstream ${resp.status}`);
        }
        if (resp.status === 200 && start > 0) {
          stop();
          throw new Error('upstream ignoró Range');
        }
        if (entry.total === null) {
          const cr = resp.headers.get('content-range') || '';
          const m = /\/(\d+)\s*$/.exec(cr);
          const total = m ? Number(m[1]) : Number(resp.headers.get('content-length'));
          if (!Number.isFinite(total) || total <= 0) {
            stop();
            throw new Error('upstream sin tamaño total');
          }
          entry.total = total;
          const ct = resp.headers.get('content-type');
          if (ct && ct.startsWith('audio/')) entry.contentType = ct;
          entry._readyResolve();
        }
        kick();
        for await (const chunk of resp.body) {
          kick();
          await fh.write(chunk, 0, chunk.length, entry.written);
          entry.written += chunk.length;
          entry.events.emit('progress');
        }
        stop();
        if (resp.status === 200) break;
      }
      if (entry.written !== entry.total) {
        throw new Error(`incompleto ${entry.written}/${entry.total}`);
      }
      await fh.close();
      await rename(entry.partPath, entry.finalPath);
      entry.done = true;
      entry.events.emit('progress');
      try { onComplete?.(entry); } catch { /* registro best-effort */ }
      return entry.finalPath;
    } catch (err) {
      entry.error = err instanceof Error ? err : new Error(String(err));
      entry._readyReject(entry.error);
      entry.events.emit('progress');
      try { await fh.close(); } catch {}
      unlink(entry.partPath).catch(() => {});
      throw entry.error;
    }
  }

  /** @returns {ProgressiveEntry|null} */
  function get(ytId) {
    return entries.get(ytId) ?? null;
  }

  /**
   * Arranca (o reutiliza) la descarga de `ytId` desde `url`.
   * @param {string} ytId
   * @param {string} url
   * @param {{ onUpstreamDead?: () => Promise<string> }} [opts]
   * @returns {ProgressiveEntry}
   */
  function start(ytId, url, { onUpstreamDead } = {}) {
    const existing = entries.get(ytId);
    if (existing) return existing;
    /** @type {any} */
    const entry = {
      ytId,
      url,
      // Nombre propio: nunca colisiona con el `.part` de yt-dlp.
      partPath: join(dir, `${ytId}.m4a.prog-${process.pid}-${Date.now()}.part`),
      finalPath: join(dir, `${ytId}.m4a`),
      total: null,
      contentType: 'audio/mp4',
      written: 0,
      done: false,
      error: null,
      events: new EventEmitter(),
    };
    entry.events.setMaxListeners(0);
    entry.ready = new Promise((res, rej) => { entry._readyResolve = res; entry._readyReject = rej; });
    entry.ready.catch(() => {});
    entry.finished = run(entry, onUpstreamDead);
    entry.finished.catch(() => {}).finally(() => {
      if (entries.get(ytId) === entry) entries.delete(ytId);
    });
    entries.set(ytId, entry);
    return entry;
  }

  function waitProgress(entry, res) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        entry.events.off('progress', done);
        res.off('close', done);
        resolve();
      };
      const t = setTimeout(done, STALL_MS);
      entry.events.once('progress', done);
      res.once('close', done);
    });
  }

  /**
   * Sirve la petición (con o sin Range) desde la descarga en curso.
   *
   * @returns {Promise<'served'|'far'|'not-ready'>}
   *   - served: respondido (aunque el cliente cortara a mitad).
   *   - far: seek más allá de lo descargado; el caller debe hacer proxy
   *     directo de ese rango (no se escribió nada al cliente).
   *   - not-ready: no se pudo conocer el tamaño a tiempo (sin escribir nada);
   *     el caller debe usar su fallback.
   */
  async function serve(req, res, entry) {
    try {
      await entry.ready;
    } catch {
      return 'not-ready';
    }
    const total = /** @type {number} */ (entry.total);
    const rangeHeader = req.headers.range ? String(req.headers.range) : null;
    let start = 0;
    let end = total - 1;
    if (rangeHeader) {
      const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      if (m && m[1] === '' && m[2] !== '') {
        start = Math.max(0, total - Number(m[2])); // sufijo: últimos N bytes
      } else if (m) {
        start = Number(m[1] || 0);
        if (m[2] !== '') end = Math.min(Number(m[2]), total - 1);
      }
      if (start >= total || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return 'served';
      }
    }
    if (!entry.done && start > entry.written + FAR_SEEK_BYTES) return 'far';

    const headers = {
      'Content-Type': entry.contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Cache-Control': 'no-store, no-transform',
    };
    if (rangeHeader) {
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}` });
    } else {
      res.writeHead(200, headers);
    }

    let closed = false;
    res.on('close', () => { closed = true; });

    let fh;
    try {
      // Si ya terminó y se renombró, el .part ya no existe.
      fh = await open(entry.done ? entry.finalPath : entry.partPath, 'r')
        .catch(() => open(entry.finalPath, 'r'));
    } catch {
      res.destroy();
      return 'served';
    }

    try {
      let pos = start;
      while (pos <= end && !closed) {
        const avail = entry.done ? total : entry.written;
        if (pos >= avail) {
          if (entry.error) break;
          await waitProgress(entry, res);
          continue;
        }
        const buf = Buffer.allocUnsafe(Math.min(READ_BYTES, avail - pos, end - pos + 1));
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
        if (bytesRead === 0) {
          await waitProgress(entry, res);
          continue;
        }
        pos += bytesRead;
        if (!res.write(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead))) {
          await drainOrClose(res);
        }
      }
      if (closed) return 'served';
      if (pos <= end) {
        // La descarga falló a mitad: cortar para que el cliente reintente.
        res.destroy();
      } else {
        res.end();
      }
    } finally {
      await fh.close().catch(() => {});
    }
    return 'served';
  }

  return { get, start, serve, size: () => entries.size };
}

/** Espera 'drain' o 'close' sin dejar listeners colgados. */
function drainOrClose(res) {
  return new Promise((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });
}

/**
 * Duración en segundos que googlevideo incluye en la URL (`dur=213.441`).
 * Evita una llamada extra a yt-dlp para el guard de duración del prewarm.
 * @param {string} url
 * @returns {number|null}
 */
export function durationFromUrl(url) {
  try {
    const v = Number(new URL(url).searchParams.get('dur'));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
