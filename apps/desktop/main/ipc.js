/**
 * Canales IPC entre el renderer (UI) y el main (Node).
 * @module main/ipc
 */

import { ipcMain, app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { mkdirSync, statSync, existsSync, unlinkSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { getMetadata, downloadAudio, getStreamUrl, search } from '@ritmiq/yt/ytdlp';
import { translateYtdlpError } from '@ritmiq/yt';
import {
  upsertTrack, listTracks,
  registerSharedAudio, sharedAudioStats, clearSharedAudio,
  findSharedAudio,
} from '@ritmiq/db/sqlite';
import { copyFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getYtDlpPath, getYtDlpUserDataPath } from './ytdlp-path.js';
import { cloudflared, getStoredToken, setStoredToken, getCustomUrl, setCustomUrl } from './cloudflared.js';
import { getOrCreateAccessToken, regenerateAccessToken } from './access-token.js';
import { detectCookiesBrowser, detectJsRuntime, exportCookiesToFile } from './cookies-detect.js';
import {
  approveDevice, rejectPairRequest, revokeDevice, renameDevice,
  listDevices, listPairRequests, getDeviceActivity, forgetDevice,
} from './devices.js';
import { invalidateDeviceCookies } from './device-cookies.js';

const YT_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/;
const ID_RE = /^[\w-]{11}$/;

function isYoutubeRef(s) {
  return YT_RE.test(s) || ID_RE.test(s);
}

/**
 * Replica un track venido de Supabase a la SQLite local, preservando los
 * campos por-dispositivo (is_downloaded, file_path).
 *
 * Maneja "ID drift": si SQLite ya tiene este (user_id, yt_id) bajo otro
 * UUID (de sesión anterior), migra el ID al canónico de Supabase
 * actualizando las FKs (playlist_tracks, play_history) y preservando el
 * estado local de descarga.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {any} track
 */
function syncRemoteTrack(db, track) {
  if (!track?.id) return false;

  // Caso A: ya está bajo el mismo id.
  const sameId = db
    .prepare('SELECT is_downloaded, file_path FROM tracks WHERE id = ?')
    .get(track.id);
  if (sameId) {
    upsertTrack(db, {
      ...track,
      isDownloaded: !!sameId.is_downloaded,
      filePath: sameId.file_path,
    });
    return true;
  }

  // Caso B: existe con OTRO id pero mismo (user_id, yt_id) → migrar.
  if (track.ytId) {
    const dup = db.prepare(/* sql */ `
      SELECT id, is_downloaded, file_path
      FROM tracks WHERE user_id = ? AND yt_id = ?
    `).get(track.userId, track.ytId);

    if (dup) {
      const migrate = db.transaction(() => {
        // Reasignar FKs antes de borrar la fila vieja
        // (playlist_tracks tiene ON DELETE CASCADE).
        db.prepare('UPDATE playlist_tracks SET track_id = ? WHERE track_id = ?')
          .run(track.id, dup.id);
        db.prepare('UPDATE play_history    SET track_id = ? WHERE track_id = ?')
          .run(track.id, dup.id);
        db.prepare('DELETE FROM tracks WHERE id = ?').run(dup.id);
        upsertTrack(db, {
          ...track,
          isDownloaded: !!dup.is_downloaded,
          filePath: dup.file_path,
        });
      });
      migrate();
      return true;
    }
  }

  // Caso C: no existe en absoluto.
  upsertTrack(db, { ...track, isDownloaded: false, filePath: null });
  return true;
}

/**
 * @param {Object} ctx
 * @param {import('better-sqlite3').Database} ctx.db
 * @param {{ port: number|null }} ctx.lan
 * @param {string} ctx.accessToken  Token Bearer para clientes externos.
 */
export function registerIpc({ db, lan, accessToken }) {
  const binary = getYtDlpPath();
  // Cookies + JS runtime + cache para yt-dlp.
  // Ver `cookies-detect.js` y `ytdlp-wrapper.js` para el "por qué".
  const cookiesFromBrowser = detectCookiesBrowser();
  const jsRuntime = detectJsRuntime();
  const cacheDir = join(app.getPath('userData'), 'yt-dlp-cache');
  try { mkdirSync(cacheDir, { recursive: true }); } catch {}
  const ytOpts = {
    binary,
    cookiesFromBrowser: cookiesFromBrowser ?? undefined,
    cookiesFile: undefined,
    jsRuntime: jsRuntime ?? undefined,
    cacheDir,
  };
  if (cookiesFromBrowser) {
    console.log(`[ipc] yt-dlp cookies: ${cookiesFromBrowser}`);
    // Reusar el cookie file que cachea lan-server (mismo path en tmpdir).
    // Lo intentamos resolver una sola vez; si no existe aún, dejamos
    // cookiesFromBrowser como fallback.
    exportCookiesToFile(binary, cookiesFromBrowser).then((file) => {
      if (file) ytOpts.cookiesFile = file;
    });
  }
  if (jsRuntime) console.log(`[ipc] yt-dlp js-runtime: ${jsRuntime}`);
  else console.log('[ipc] yt-dlp SIN runtime JS — instala Deno o Node para reproducción fiable');

  ipcMain.handle('app:info', () => ({
    lanPort: lan.port,
    audioDir: getAudioDir(),
    ytdlpPath: binary,
    accessToken,
  }));

  // ─── Cloudflare Tunnel ───────────────────────────────────────────────
  ipcMain.handle('tunnel:status', () => ({
    ...cloudflared.state,
    hasToken: Boolean(getStoredToken()),
    customUrl: getCustomUrl(),
  }));

  ipcMain.handle('tunnel:setCustomUrl', (_e, url) => {
    setCustomUrl(url);
    // Si está conectado, refleja la URL custom en el estado actual.
    if (url && cloudflared.state.status === 'connected') {
      cloudflared.setState({ url });
    }
    return { ...cloudflared.state, hasToken: Boolean(getStoredToken()), customUrl: url };
  });

  ipcMain.handle('tunnel:setToken', async (_e, token) => {
    setStoredToken(token);
    if (token) {
      await cloudflared.restart();
    } else {
      await cloudflared.stop();
    }
    return { ...cloudflared.state, hasToken: Boolean(getStoredToken()) };
  });

  ipcMain.handle('tunnel:start', async (_e, opts) => {
    await cloudflared.start(opts ?? {});
    return { ...cloudflared.state, hasToken: Boolean(getStoredToken()) };
  });

  ipcMain.handle('tunnel:startQuick', async () => {
    await cloudflared.start({ mode: 'quick' });
    return { ...cloudflared.state, hasToken: Boolean(getStoredToken()) };
  });

  ipcMain.handle('tunnel:stop', async () => {
    await cloudflared.stop();
    return { ...cloudflared.state, hasToken: Boolean(getStoredToken()) };
  });

  // Suscripción a cambios de estado del tunnel: el preload registra un
  // listener que reenvía eventos al renderer.
  cloudflared.onChange((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('tunnel:state', {
          ...state,
          hasToken: Boolean(getStoredToken()),
        });
      } catch {}
    }
  });

  // ─── Access token (Bearer) ───────────────────────────────────────────
  ipcMain.handle('auth:token', () => getOrCreateAccessToken());
  ipcMain.handle('auth:regenerateToken', () => regenerateAccessToken());

  ipcMain.handle('yt:metadata', (_e, idOrUrl) => getMetadata(idOrUrl, ytOpts));
  ipcMain.handle('yt:streamUrl', (_e, idOrUrl) => getStreamUrl(idOrUrl, ytOpts));
  ipcMain.handle('yt:search', async (_e, query) => search(query, { ...ytOpts, max: 15 }));

  // Información y actualización del binario yt-dlp.
  ipcMain.handle('ytdlp:info', async () => {
    const path = getYtDlpPath();
    let version = null;
    try {
      const r = spawnSync(path, ['--version'], { encoding: 'utf8' });
      version = r.stdout?.trim() || null;
    } catch {}
    return { path, version };
  });

  ipcMain.handle('ytdlp:update', async () => {
    const platform = process.platform;
    const target = platform === 'win32'  ? 'yt-dlp.exe'
                 : platform === 'darwin' ? 'yt-dlp_macos'
                 : 'yt-dlp';
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${target}`;
    const out = getYtDlpUserDataPath();

    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Descarga falló: HTTP ${res.status}`);
    if (!res.body) throw new Error('Respuesta vacía');

    await pipeline(res.body, createWriteStream(out));
    if (platform !== 'win32') chmodSync(out, 0o755);

    // Devuelve la nueva versión instalada.
    const r = spawnSync(out, ['--version'], { encoding: 'utf8' });
    return { path: out, version: r.stdout?.trim() ?? null };
  });

  ipcMain.handle('library:list', (_e, userId) => listTracks(db, userId));

  ipcMain.handle('library:addFromYoutube', async (_e, payload) => {
    const { idOrUrl, userId } = payload;
    const meta = await getMetadata(idOrUrl, ytOpts);
    return persistTrack(db, meta, userId);
  });

  // Añadir a partir de un resultado de búsqueda (ya tenemos metadata, sin re-fetch).
  ipcMain.handle('library:addFromMetadata', async (_e, payload) => {
    const { meta, userId } = payload;
    return persistTrack(db, meta, userId);
  });

  ipcMain.handle('library:syncRemote', (_e, track) => syncRemoteTrack(db, track));

  ipcMain.handle('library:deleteRemote', (_e, trackId) => {
    db.prepare('DELETE FROM tracks WHERE id = ?').run(trackId);
    return true;
  });

  ipcMain.handle('library:download', async (e, payload) => {
    // Acepta string (id) o { trackId, fallback?: Track }. El fallback
    // permite que el renderer envíe la fila completa si la SQLite local
    // aún no la tiene (típico tras importar via Spotify, donde el track
    // vive en Supabase pero quizás no se replicó a SQLite).
    const trackId = typeof payload === 'string' ? payload : payload?.trackId;
    const fallback = typeof payload === 'object' ? payload?.fallback : null;
    if (!trackId) throw new Error('trackId required');

    let row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);

    // Si no está y tenemos fallback, sincronizamos via la lógica de
    // syncRemote (que maneja "ID drift": si el track ya existía con
    // otro UUID por mismo yt_id, migra al UUID canónico).
    if (!row && fallback) {
      try {
        await syncRemoteTrack(db, fallback);
        row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);
      } catch (err) {
        console.warn('[library:download] failed to sync fallback', err);
      }
    }

    if (!row || row.source !== 'youtube' || !row.yt_id) {
      throw new Error('Esta canción no se puede descargar (no tiene origen YouTube válido).');
    }
    const dir = getAudioDir();
    const out = join(dir, `${row.id}`);

    // ── CACHE COMPARTIDO FIRST ──────────────────────────────────────────
    // Antes saltabamos directo a yt-dlp aunque otro user (o sesion vieja)
    // ya tuviese el archivo en shared_audio. Resultado: re-fetch innecesario
    // y si YouTube ahora bloquea el video, fallo total cuando teniamos copia
    // local valida. Replicamos aqui el flow del endpoint LAN /download/.
    try {
      const cached = findSharedAudio(db, row.yt_id);
      if (cached && cached.filePath && existsSync(cached.filePath)) {
        // Copiar el archivo cacheado al audio dir del owner para que
        // file_path local apunte a un archivo del owner (semantica clara:
        // shared_audio es indice global, audio/ es coleccion del owner).
        const ext = cached.filePath.match(/\.(\w+)$/)?.[1] ?? 'm4a';
        const finalPath = `${out}.${ext}`;
        if (cached.filePath !== finalPath) {
          copyFileSync(cached.filePath, finalPath);
        }
        db.prepare(/* sql */ `
          UPDATE tracks SET is_downloaded = 1, file_path = ?, updated_at = ?
          WHERE id = ?
        `).run(finalPath, new Date().toISOString(), row.id);
        console.log(`[ipc] library:download ${row.yt_id} CACHE HIT -> ${finalPath}`);
        return finalPath;
      }
    } catch (err) {
      console.warn('[ipc] cache lookup failed, falling back to yt-dlp:', err?.message);
    }

    // ── yt-dlp fallback ────────────────────────────────────────────────
    try {
      await downloadAudio(row.yt_id, out, {
        ...ytOpts,
        format: 'opus',
        onProgress: (pct) => {
          try { e.sender.send('library:download:progress', { trackId, pct }); } catch {}
        },
      });
    } catch (err) {
      // Opcion B: error user-friendly. Conservamos el stderr original en
      // console para diagnostico tecnico, pero al renderer le mandamos
      // un mensaje en espanol accionable.
      console.warn(`[ipc] yt-dlp falló para ${row.yt_id}:`, err?.message);
      throw new Error(translateYtdlpError(err));
    }
    const finalPath = `${out}.opus`;
    db.prepare(/* sql */ `
      UPDATE tracks SET is_downloaded = 1, file_path = ?, updated_at = ?
      WHERE id = ?
    `).run(finalPath, new Date().toISOString(), row.id);
    // Indexar también en cache compartido para que otras cuentas que
    // tengan este mismo ytId reciban el archivo sin re-descargar.
    try {
      const size = statSync(finalPath).size;
      registerSharedAudio(db, {
        ytId: row.yt_id,
        filePath: finalPath,
        mime: 'audio/ogg', // opus en contenedor ogg
        size,
      });
    } catch (err) {
      console.warn('[ipc] registerSharedAudio failed:', err.message);
    }
    return finalPath;
  });

  // ─── Cache compartido (admin) ───────────────────────────────────────
  ipcMain.handle('sharedCache:stats', () => sharedAudioStats(db));
  ipcMain.handle('sharedCache:clear', () => clearSharedAudio(db));

  ipcMain.handle('library:undownload', async (_e, trackId) => {
    const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId);
    if (!row) return false;
    if (row.file_path && existsSync(row.file_path)) {
      try { unlinkSync(row.file_path); } catch {}
    }
    db.prepare(/* sql */ `
      UPDATE tracks SET is_downloaded = 0, file_path = NULL, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), trackId);
    return true;
  });

  ipcMain.handle('library:fileSize', async (_e, trackId) => {
    const row = db.prepare('SELECT file_path FROM tracks WHERE id = ?').get(trackId);
    if (!row?.file_path || !existsSync(row.file_path)) return 0;
    try { return statSync(row.file_path).size; } catch { return 0; }
  });

  // ── PLAYLISTS ────────────────────────────────────────────────────────
  ipcMain.handle('playlists:list', (_e, userId) => {
    return db.prepare('SELECT * FROM playlists WHERE user_id = ? ORDER BY created_at')
      .all(userId)
      .map(rowToPlaylist);
  });

  ipcMain.handle('playlists:upsert', (_e, playlist) => {
    const now = new Date().toISOString();
    db.prepare(/* sql */ `
      INSERT INTO playlists (id, user_id, name, is_offline, cover_url, created_at, updated_at)
      VALUES (@id, @userId, @name, @isOffline, @coverUrl, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        is_offline = excluded.is_offline,
        cover_url = excluded.cover_url,
        updated_at = excluded.updated_at
    `).run({
      id: playlist.id,
      userId: playlist.userId,
      name: playlist.name,
      isOffline: playlist.isOffline ? 1 : 0,
      coverUrl: playlist.coverUrl ?? null,
      createdAt: playlist.createdAt ?? now,
      updatedAt: now,
    });
    return playlist;
  });

  ipcMain.handle('playlists:delete', (_e, playlistId) => {
    db.prepare('DELETE FROM playlists WHERE id = ?').run(playlistId);
    return true;
  });

  ipcMain.handle('playlists:tracks', (_e, playlistId) => {
    return db.prepare(/* sql */ `
      SELECT t.*, pt.position
      FROM playlist_tracks pt
      JOIN tracks t ON t.id = pt.track_id
      WHERE pt.playlist_id = ?
      ORDER BY pt.position
    `).all(playlistId).map(rowToTrack);
  });

  ipcMain.handle('playlists:addTrack', (_e, { playlistId, trackId }) => {
    const max = db.prepare('SELECT COALESCE(MAX(position),-1) AS m FROM playlist_tracks WHERE playlist_id = ?')
      .get(playlistId);
    db.prepare(/* sql */ `
      INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position)
      VALUES (?, ?, ?)
    `).run(playlistId, trackId, max.m + 1);
    return true;
  });

  ipcMain.handle('playlists:removeTrack', (_e, { playlistId, trackId }) => {
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?')
      .run(playlistId, trackId);
    return true;
  });

  ipcMain.handle('playlists:reorder', (_e, { playlistId, orderedTrackIds }) => {
    const tx = db.transaction((ids) => {
      ids.forEach((trackId, position) => {
        db.prepare(/* sql */ `
          UPDATE playlist_tracks SET position = ?
          WHERE playlist_id = ? AND track_id = ?
        `).run(position, playlistId, trackId);
      });
    });
    tx(orderedTrackIds);
    return true;
  });

  // ─── Devices (Modelo Y: pareo de PWAs) ──────────────────────────────
  ipcMain.handle('devices:list', () => listDevices(db));
  ipcMain.handle('devices:pending', () => listPairRequests(db));
  ipcMain.handle('devices:approve', (_e, deviceId) => {
    // Mueve la pair_request -> devices y emite device_token. Lee la fila
    // pendiente para obtener display_name + supabase_user_id + cookies.
    const pending = db.prepare(
      'SELECT display_name, supabase_user_id, cookies_blob FROM pair_requests WHERE device_id = ?'
    ).get(deviceId);
    if (!pending) throw new Error('pair_request not found or expired');
    const token = approveDevice(db, {
      deviceId,
      displayName: pending.display_name,
      supabaseUserId: pending.supabase_user_id,
      cookiesBlob: pending.cookies_blob,
    });
    return { ok: true, deviceToken: token };
  });
  ipcMain.handle('devices:reject', (_e, deviceId) => {
    rejectPairRequest(db, deviceId);
    return { ok: true };
  });
  ipcMain.handle('devices:revoke', (_e, deviceId) => {
    revokeDevice(db, deviceId);
    invalidateDeviceCookies(deviceId);
    return { ok: true };
  });
  ipcMain.handle('devices:forget', (_e, deviceId) => {
    forgetDevice(db, deviceId);
    invalidateDeviceCookies(deviceId);
    return { ok: true };
  });
  ipcMain.handle('devices:rename', (_e, { deviceId, name }) => {
    renameDevice(db, deviceId, String(name));
    return { ok: true };
  });
  ipcMain.handle('devices:activity', (_e, { deviceId, limit }) =>
    getDeviceActivity(db, deviceId, Number(limit) || 50)
  );

  // Notificacion en vivo cuando llega un pair_request: subscribe al
  // hook expuesto por lan-server y reenvia al renderer + notification.
  try {
    lan.onPairRequest?.((pairReq) => {
      for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send('devices:pair-request', pairReq); } catch {}
      }
      try {
        const { Notification } = require('electron');
        if (Notification.isSupported()) {
          new Notification({
            title: 'Ritmiq · Nueva solicitud de pareo',
            body: `${pairReq.displayName} pide acceso · PIN ${pairReq.pin}`,
          }).show();
        }
      } catch {}
    });
  } catch (err) {
    console.warn('[ipc] could not subscribe to pair-request events:', err?.message);
  }

  ipcMain.handle('playlists:contents', (_e, userId) => {
    // Devuelve mapa { playlistId: [trackId,…] } para todas las playlists del usuario.
    const rows = db.prepare(/* sql */ `
      SELECT pt.playlist_id, pt.track_id, pt.position
      FROM playlist_tracks pt
      JOIN playlists p ON p.id = pt.playlist_id
      WHERE p.user_id = ?
      ORDER BY pt.position
    `).all(userId);
    /** @type {Record<string,string[]>} */
    const out = {};
    for (const r of rows) {
      if (!out[r.playlist_id]) out[r.playlist_id] = [];
      out[r.playlist_id].push(r.track_id);
    }
    return out;
  });
}

function rowToPlaylist(r) {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    isOffline: !!r.is_offline,
    coverUrl: r.cover_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function persistTrack(db, meta, userId) {
  // Si ya existe (mismo yt_id para ese user), reusar.
  const existing = db
    .prepare('SELECT * FROM tracks WHERE user_id = ? AND yt_id = ?')
    .get(userId, meta.id);
  if (existing) return rowToTrack(existing);

  /** @type {import('@ritmiq/core/types').Track} */
  const track = {
    id: randomUUID(),
    userId,
    source: 'youtube',
    ytId: meta.id,
    title: meta.title,
    artist: meta.uploader ?? null,
    album: null,
    durationSeconds: meta.duration ?? null,
    coverUrl: meta.thumbnail ?? null,
    filePath: null,
    isDownloaded: false,
    createdAt: new Date().toISOString(),
  };
  upsertTrack(db, track);
  return track;
}

function rowToTrack(r) {
  return {
    id: r.id,
    userId: r.user_id,
    source: r.source,
    ytId: r.yt_id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    durationSeconds: r.duration_seconds,
    coverUrl: r.cover_url,
    filePath: r.file_path,
    isDownloaded: !!r.is_downloaded,
    createdAt: r.created_at,
  };
}

function getAudioDir() {
  const dir = join(app.getPath('userData'), 'audio');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export { isYoutubeRef };
