/**
 * Adapter SQLite para el proceso main de Electron (better-sqlite3).
 * Sólo se importa en Node — no usar desde el renderer ni desde la PWA.
 *
 * @module @ritmiq/db/sqlite
 */

import { SCHEMA_SQL } from './schema.js';
import { existsSync, statSync, unlinkSync } from 'node:fs';

/**
 * @typedef {import('@ritmiq/core/types').Track} Track
 * @typedef {import('better-sqlite3').Database} BetterDb
 */

/**
 * Inicializa la DB y aplica el schema.
 * Aplica también micro-migraciones idempotentes para evolucionar tablas
 * existentes sin tener que tirar la DB.
 *
 * @param {BetterDb} db
 */
export function applySchema(db) {
  db.exec(SCHEMA_SQL);
  // Migraciones aditivas (idempotentes)
  addColumnIfMissing(db, 'playlists', 'cover_url', 'TEXT');
  // Backfill `shared_audio` desde tracks ya descargados. Idempotente:
  // INSERT OR IGNORE evita duplicar ytIds y `existsSync` evita rows
  // huérfanos si el archivo fue borrado externamente.
  backfillSharedAudio(db);
}

/**
 * Popula `shared_audio` con los archivos ya descargados en `tracks`.
 * Se ejecuta en cada arranque pero solo inserta lo que falte.
 *
 * @param {BetterDb} db
 */
function backfillSharedAudio(db) {
  try {
    const rows = db.prepare(/* sql */ `
      SELECT yt_id, file_path FROM tracks
      WHERE is_downloaded = 1 AND yt_id IS NOT NULL AND file_path IS NOT NULL
    `).all();
    if (rows.length === 0) return;
    const stmt = db.prepare(/* sql */ `
      INSERT OR IGNORE INTO shared_audio (yt_id, file_path, mime, size, downloaded_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const tx = db.transaction((items) => {
      for (const it of items) stmt.run(...it);
    });
    const items = [];
    for (const r of rows) {
      if (!existsSync(r.file_path)) continue;
      const mime = r.file_path.endsWith('.opus') ? 'audio/ogg'
                 : r.file_path.endsWith('.m4a')  ? 'audio/mp4'
                 : r.file_path.endsWith('.mp3')  ? 'audio/mpeg'
                 : 'application/octet-stream';
      try {
        const size = statSync(r.file_path).size;
        items.push([r.yt_id, r.file_path, mime, size, new Date().toISOString()]);
      } catch { /* skip */ }
    }
    if (items.length) {
      tx(items);
      console.log(`[db] shared_audio backfill: ${items.length} archivos indexados`);
    }
  } catch (err) {
    console.warn('[db] shared_audio backfill failed:', err.message);
  }
}

/**
 * Registra un archivo de audio en el cache compartido. Idempotente.
 *
 * @param {BetterDb} db
 * @param {{ ytId: string, filePath: string, mime: string, size: number }} entry
 */
export function registerSharedAudio(db, { ytId, filePath, mime, size }) {
  if (!ytId || !filePath) return;
  db.prepare(/* sql */ `
    INSERT INTO shared_audio (yt_id, file_path, mime, size, downloaded_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(yt_id) DO UPDATE SET
      file_path = excluded.file_path,
      mime = excluded.mime,
      size = excluded.size,
      downloaded_at = excluded.downloaded_at
  `).run(ytId, filePath, mime, size, new Date().toISOString());
}

/**
 * Busca un archivo compartido por ytId. Devuelve null si no existe o si
 * el archivo fue borrado del disco (en cuyo caso limpia la row).
 *
 * @param {BetterDb} db
 * @param {string} ytId
 * @returns {{ ytId:string, filePath:string, mime:string, size:number }|null}
 */
export function findSharedAudio(db, ytId) {
  if (!ytId) return null;
  const row = db.prepare('SELECT * FROM shared_audio WHERE yt_id = ?').get(ytId);
  if (!row) return null;
  if (!existsSync(row.file_path)) {
    db.prepare('DELETE FROM shared_audio WHERE yt_id = ?').run(ytId);
    return null;
  }
  return {
    ytId: row.yt_id,
    filePath: row.file_path,
    mime: row.mime,
    size: row.size,
  };
}

/**
 * Estadísticas del cache compartido para mostrar en Ajustes.
 * @param {BetterDb} db
 * @returns {{ count: number, totalBytes: number }}
 */
export function sharedAudioStats(db) {
  const r = db.prepare(/* sql */ `
    SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS total FROM shared_audio
  `).get();
  return { count: r?.count ?? 0, totalBytes: r?.total ?? 0 };
}

/**
 * Borra todos los archivos del cache compartido (FS + tabla).
 * Tracks que apunten al mismo file_path en `tracks` quedan con
 * `is_downloaded=1` pero el archivo dejará de existir — se marcan también
 * como no descargados para mantener consistencia.
 *
 * @param {BetterDb} db
 * @returns {{ removed: number, freedBytes: number }}
 */
export function clearSharedAudio(db) {
  const rows = db.prepare('SELECT yt_id, file_path, size FROM shared_audio').all();
  let removed = 0;
  let freed = 0;
  for (const r of rows) {
    if (r.file_path && existsSync(r.file_path)) {
      try { unlinkSync(r.file_path); removed++; freed += (r.size ?? 0); } catch {}
    }
  }
  db.exec(`
    DELETE FROM shared_audio;
    UPDATE tracks SET is_downloaded = 0, file_path = NULL
      WHERE is_downloaded = 1;
  `);
  return { removed, freedBytes: freed };
}

/** @param {BetterDb} db @param {string} table @param {string} col @param {string} type */
function addColumnIfMissing(db, table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
}

/**
 * @param {BetterDb} db
 * @param {Track} t
 */
export function upsertTrack(db, t) {
  const stmt = db.prepare(/* sql */ `
    INSERT INTO tracks (id, user_id, source, yt_id, title, artist, album,
                        duration_seconds, cover_url, file_path, is_downloaded,
                        created_at, updated_at)
    VALUES (@id, @userId, @source, @ytId, @title, @artist, @album,
            @durationSeconds, @coverUrl, @filePath, @isDownloaded,
            @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      duration_seconds = excluded.duration_seconds,
      cover_url = excluded.cover_url,
      file_path = excluded.file_path,
      is_downloaded = excluded.is_downloaded,
      updated_at = excluded.updated_at
  `);
  stmt.run({
    ...t,
    isDownloaded: t.isDownloaded ? 1 : 0,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * @param {BetterDb} db
 * @param {string} userId
 * @returns {Track[]}
 */
export function listTracks(db, userId) {
  const rows = db
    .prepare(/* sql */ `SELECT * FROM tracks WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId);
  return rows.map(rowToTrack);
}

/**
 * @param {any} r
 * @returns {Track}
 */
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
