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
import { createReadStream, statSync, existsSync } from 'node:fs';
import { Bonjour } from 'bonjour-service';
import { getStreamUrl, getMetadata, search } from '@ritmiq/yt/ytdlp';
import { getYtDlpPath } from './ytdlp-path.js';

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

  // Cache en memoria de URLs de stream resueltas por yt-dlp.
  // Las URLs de googlevideo expiran a las ~6h; cacheamos 30 minutos para
  // estar muy holgados. Resolver yt-dlp tarda 2-5s, esto evita la espera
  // en reproducciones repetidas / pre-resolves.
  /** @type {Map<string, { url: string, expiresAt: number, inflight?: Promise<string> }>} */
  const streamCache = new Map();
  const TTL_MS = 30 * 60 * 1000;

  async function resolveCached(ytId) {
    const now = Date.now();
    const hit = streamCache.get(ytId);
    if (hit) {
      if (hit.url && hit.expiresAt > now) return hit.url;
      if (hit.inflight) return hit.inflight;
    }
    const inflight = getStreamUrl(ytId, { binary: ytBinary });
    streamCache.set(ytId, { url: '', expiresAt: 0, inflight });
    try {
      const url = await inflight;
      streamCache.set(ytId, { url, expiresAt: now + TTL_MS });
      return url;
    } catch (err) {
      streamCache.delete(ytId);
      throw err;
    }
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

      // Resto de rutas: requieren autenticación si hay accessToken configurado.
      if (!isAuthorized(req, url)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (url.pathname === '/yt/search') {
        const q = url.searchParams.get('q');
        if (!q) { res.writeHead(400).end('q required'); return; }
        const items = await search(q, { binary: ytBinary, max: 12 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items }));

        // Pre-resolver los stream URLs de los 3 primeros resultados en
        // background. Cuando el usuario elija cualquiera, ya estará cacheado.
        for (const it of items.slice(0, 3)) {
          if (it?.id) resolveCached(it.id).catch(() => {});
        }
        return;
      }

      // Permite al cliente "calentar" el cache antes de pulsar play.
      if (url.pathname === '/yt/prewarm') {
        const ytId = url.searchParams.get('q');
        if (!ytId) { res.writeHead(400).end('q required'); return; }
        resolveCached(ytId).catch(() => {});
        res.writeHead(204).end();
        return;
      }

      if (url.pathname === '/yt/metadata') {
        const idOrUrl = url.searchParams.get('q');
        if (!idOrUrl) { res.writeHead(400).end('q required'); return; }
        const meta = await getMetadata(idOrUrl, { binary: ytBinary });
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

      if (url.pathname.startsWith('/stream/')) {
        const trackId = decodeURIComponent(url.pathname.slice('/stream/'.length));

        // Track efímero: el id viene como "yt:<ytId>". Resolvemos vía yt-dlp
        // y proxieamos los bytes (no redirect — las URLs de googlevideo van
        // atadas a la IP del cliente original, así que el iPhone no podría
        // consumirlas directamente).
        if (trackId.startsWith('yt:')) {
          const ytId = trackId.slice(3);
          const streamUrl = await resolveCached(ytId);
          return proxyAudio(req, res, streamUrl);
        }

        const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);
        if (!row) {
          res.writeHead(404).end('not found');
          return;
        }

        // Descargado en disco → streaming con Range desde el archivo.
        if (row.is_downloaded && row.file_path && existsSync(row.file_path)) {
          return serveLocalFile(req, res, row.file_path);
        }

        // YouTube no descargado → proxy del stream resuelto.
        if (row.source === 'youtube' && row.yt_id) {
          const streamUrl = await resolveCached(row.yt_id);
          return proxyAudio(req, res, streamUrl);
        }

        res.writeHead(404).end('source unavailable');
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
