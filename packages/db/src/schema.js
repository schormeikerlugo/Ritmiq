/**
 * Schema SQLite del cliente (espejo simplificado del Postgres en Supabase).
 * En SQLite usamos TEXT para UUIDs y timestamps ISO.
 *
 * @module @ritmiq/db/schema
 */

export const SCHEMA_SQL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tracks (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('youtube','local')),
  yt_id            TEXT,
  title            TEXT NOT NULL,
  artist           TEXT,
  album            TEXT,
  duration_seconds INTEGER,
  cover_url        TEXT,
  file_path        TEXT,
  is_downloaded    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_user        ON tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_downloaded  ON tracks(is_downloaded);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_yt   ON tracks(user_id, yt_id) WHERE yt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS playlists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  is_offline  INTEGER NOT NULL DEFAULT 0,
  cover_url   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    TEXT NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS play_history (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL,
  track_id  TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  played_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id                  TEXT PRIMARY KEY,
  table_name          TEXT NOT NULL,
  op                  TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  payload_json        TEXT NOT NULL,
  client_updated_at   TEXT NOT NULL,
  attempts            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);

-- Cache de audio compartido entre cuentas, indexado por ytId (no por
-- trackId). Permite que cualquier usuario que reproduzca un ytId ya
-- descargado por OTRO usuario en el mismo desktop reciba el archivo
-- desde disco. Independiente del schema 'tracks' (que es per-owner).
-- Autorización: el LAN server sólo sirve este archivo si el request
-- viene con firma HMAC válida emitida por la Edge 'sign-stream', que
-- a su vez valida RLS — así seguimos respetando que cada user sólo
-- accede a tracks que tiene en su biblioteca.
CREATE TABLE IF NOT EXISTS shared_audio (
  yt_id         TEXT PRIMARY KEY,
  file_path     TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  downloaded_at TEXT NOT NULL
);
`;
