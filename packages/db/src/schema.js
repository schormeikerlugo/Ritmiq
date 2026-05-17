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

-- Device pairing (Modelo Y): cada PWA (iPhone/iPad/PC navegador) se parea
-- explicitamente con este desktop una vez. El owner ve un PIN en su UI,
-- compara con el que muestra la PWA, y aprueba. La PWA recibe un
-- device_token unico que persiste en localStorage y envia como Bearer en
-- cada request. Cookies por device para que cada user use sus propias
-- credenciales de YouTube (fallback a las del owner si no las subio).
CREATE TABLE IF NOT EXISTS devices (
  device_id          TEXT PRIMARY KEY,
  device_token       TEXT NOT NULL UNIQUE,
  display_name       TEXT NOT NULL,
  supabase_user_id   TEXT,
  status             TEXT NOT NULL DEFAULT 'approved',
  cookies_blob       BLOB,
  cookies_updated_at TEXT,
  approved_at        TEXT NOT NULL,
  last_seen_at       TEXT,
  revoked_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_user   ON devices(supabase_user_id);
CREATE INDEX IF NOT EXISTS idx_devices_token  ON devices(device_token);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

-- Solicitudes de pareo pendientes. La PWA envia POST /pair con un PIN
-- mostrado en pantalla; el owner ve la solicitud en la UI del desktop y
-- aprueba (mueve la fila a devices, emite device_token). TTL 10 min,
-- prune automatico al crear nuevas requests.
CREATE TABLE IF NOT EXISTS pair_requests (
  device_id        TEXT PRIMARY KEY,
  display_name     TEXT NOT NULL,
  supabase_user_id TEXT,
  pin              TEXT NOT NULL,
  cookies_blob     BLOB,
  requested_at     TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  client_ip        TEXT
);
CREATE INDEX IF NOT EXISTS idx_pair_requests_expires ON pair_requests(expires_at);

-- Log de actividad por device. Util para auditar abuso y mostrar
-- "Ultimo uso" en la UI. Rotacion automatica a 5 dias (prune al arrancar
-- + setInterval cada 12h).
CREATE TABLE IF NOT EXISTS device_activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  track_id    TEXT,
  yt_id       TEXT,
  meta        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_device  ON device_activity(device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_created ON device_activity(created_at);
`;
