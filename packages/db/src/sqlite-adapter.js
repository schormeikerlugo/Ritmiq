/**
 * Adapter SQLite para el proceso main de Electron (better-sqlite3).
 * Sólo se importa en Node — no usar desde el renderer ni desde la PWA.
 *
 * @module @ritmiq/db/sqlite
 */

import { SCHEMA_SQL } from './schema.js';

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
