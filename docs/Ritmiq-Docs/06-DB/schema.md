---
tipo: modulo
capa: db
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: packages/db/src/schema.js
tags: [db, schema, sqlite, sql]
---

# `db/schema.js`

> Schema SQLite del cliente Desktop. Espejo simplificado del Postgres de Supabase. Todas las tablas se crean con `CREATE TABLE IF NOT EXISTS` — completamente idempotente.

## Ubicación
`packages/db/src/schema.js:1` (136 líneas)

## Constante exportada

```js
export const SCHEMA_SQL: string  // bloque SQL completo listo para db.exec()
```

Aplicado por [[sqlite-adapter#applySchema]] en cada arranque del desktop.

## PRAGMAs

```sql
PRAGMA journal_mode = WAL;   -- Mejor concurrencia lectura, sin bloqueos de escritura
PRAGMA foreign_keys = ON;    -- FK enforced (SQLite las ignora por defecto)
```

**Por qué WAL**: el [[lan-server]] y el IPC acceden a la misma DB desde el mismo proceso principal pero desde distintos contextos async. WAL permite múltiples lectores simultáneos sin que la escritura los bloquee.

## Tablas

### `tracks`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | TEXT PK | UUID, canónico de Supabase |
| `user_id` | TEXT NOT NULL | FK lógica a Supabase auth.users (no FK real en SQLite) |
| `source` | TEXT CHECK | `'youtube'` \| `'local'` |
| `yt_id` | TEXT | ID 11 chars de YouTube (null para local) |
| `title` | TEXT NOT NULL | |
| `artist` | TEXT | |
| `album` | TEXT | |
| `duration_seconds` | INTEGER | |
| `cover_url` | TEXT | |
| `file_path` | TEXT | Path absoluto del archivo descargado |
| `is_downloaded` | INTEGER DEFAULT 0 | 0 / 1 (boolean simulado) |
| `created_at` | TEXT NOT NULL | ISO datetime |
| `updated_at` | TEXT NOT NULL | ISO datetime |

Índices:
- `idx_tracks_user` → consultas por `user_id` (library).
- `idx_tracks_downloaded` → filtrar tracks offline.
- `idx_tracks_yt` → **UNIQUE** `(user_id, yt_id) WHERE yt_id IS NOT NULL` — previene duplicados del mismo video por usuario y es la clave del "ID drift" detection en [[ipc#syncRemoteTrack]].

### `playlists`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | TEXT PK | |
| `user_id` | TEXT NOT NULL | |
| `name` | TEXT NOT NULL | |
| `is_offline` | INTEGER DEFAULT 0 | Smart Download |
| `cover_url` | TEXT | Migración aditiva (ver [[sqlite-adapter#addColumnIfMissing]]) |
| `created_at` / `updated_at` | TEXT | |

### `playlist_tracks`

```sql
playlist_id TEXT REFERENCES playlists(id) ON DELETE CASCADE,
track_id    TEXT REFERENCES tracks(id)    ON DELETE CASCADE,
position    INTEGER NOT NULL,
PRIMARY KEY (playlist_id, track_id)
```

`ON DELETE CASCADE` en ambas FKs: borrar playlist o track elimina automáticamente las entradas. Crítico para el flujo de "ID drift" en [[ipc]] donde se hace DELETE + re-INSERT con nuevo UUID.

### `play_history`

```sql
track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL
```

`ON DELETE SET NULL`: si un track se borra, su historial queda con `track_id = null` (no se pierde el historial, se desvincula). Distinto de CASCADE porque el historial tiene valor sin el track.

### `sync_queue`

Cola de operaciones offline del [[sync|core/sync]]. Columna `payload_json` guarda el `Record<string, unknown>` serializado. Índice por `created_at` para FIFO.

### `shared_audio`

```sql
yt_id TEXT PRIMARY KEY,
file_path TEXT NOT NULL,
mime TEXT NOT NULL,
size INTEGER NOT NULL,
downloaded_at TEXT NOT NULL
```

Cache compartido entre cuentas indexado por `yt_id` (no por `track_id`). Autorización: el [[lan-server]] solo sirve estos archivos si el request tiene firma HMAC de [[sign-stream]], que a su vez valida RLS de Supabase.

### `devices`

```sql
device_id   TEXT PRIMARY KEY,
device_token TEXT NOT NULL UNIQUE,
-- ...
cookies_blob BLOB,   -- cifrado con safeStorage (ver device-cookies.md)
status TEXT NOT NULL DEFAULT 'approved',
```

Ver [[devices]] para lógica completa del Modelo Y.

### `pair_requests`

TTL 10 min. `expires_at` con índice para vacuum eficiente.

### `device_activity`

`id INTEGER PRIMARY KEY AUTOINCREMENT` — único int autoincrement del schema. Rotación automática a 5 días.

## Anatomía del código (snippet clave)

### El índice UNIQUE parcial de tracks — clave del ID drift
`packages/db/src/schema.js:30`

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_yt
  ON tracks(user_id, yt_id) WHERE yt_id IS NOT NULL;
```

**Por qué `WHERE yt_id IS NOT NULL`**: los tracks `source='local'` tienen `yt_id=NULL`. En SQLite, dos `NULL` no son iguales en unique constraints — podría haber múltiples tracks locales sin conflicto. El `WHERE` restringe la unicidad solo a tracks de YouTube, que sí deben ser únicos por usuario.

**Lo que habilita en [[ipc#syncRemoteTrack]]**: el handler `library:syncRemote` puede hacer `SELECT id FROM tracks WHERE user_id = ? AND yt_id = ?` y saber con certeza que habrá a lo sumo 1 fila — base para la detección y migración de ID drift.

## Convenciones

- **UUID como TEXT**: SQLite no tiene tipo UUID nativo. TEXT con UUIDs v4 estándar.
- **Timestamps como ISO TEXT**: `'2026-05-22T10:00:00.000Z'`. Comparación lexicográfica funciona si todos siguen el mismo formato.
- **Booleanos como INTEGER 0/1**: SQLite no tiene BOOLEAN. La capa de adapter ([[sqlite-adapter]]) mapea `isDownloaded: !!r.is_downloaded`.
- **No hay tipo DATETIME**: todo texto ISO. Compatible con Supabase Postgres que sí tiene TIMESTAMP, pero la conversión es trivial.

## Relación con Supabase

El schema SQLite es un subconjunto del Postgres de Supabase (ver `supabase/migrations/`). Las diferencias clave:

| Aspecto | SQLite (desktop) | Supabase Postgres |
|---|---|---|
| UUID type | TEXT | UUID nativo |
| RLS | No aplica | Habilitado |
| Tablas extras | `devices`, `pair_requests`, `device_activity`, `shared_audio` | No existen |
| `sync_queue` | Presente | No existe (es client-side) |
| `play_history` | Presente | Presente (misma estructura) |

## Dependencias entrantes
- [[sqlite-adapter#applySchema]] lo ejecuta con `db.exec(SCHEMA_SQL)`.
- [[db|apps/desktop/main/db.js]] al inicializar la DB.

## Dependencias salientes
- Ninguna — pura constante SQL.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar `PRAGMA foreign_keys = ON` | FKs se ignoran → borrar un track no limpia `playlist_tracks` → datos huérfanos. |
| Quitar la restricción `WHERE yt_id IS NOT NULL` del índice | Tracks locales (source='local') con `yt_id=NULL` colisionan entre sí en el índice unique. |
| Cambiar `ON DELETE CASCADE` a `RESTRICT` en `playlist_tracks` | Borrar un track falla si está en playlists → el usuario no puede eliminar tracks. |
| Cambiar `ON DELETE SET NULL` a `CASCADE` en `play_history` | Borrar un track elimina todo su historial de reproducción. |
| Renombrar columna sin migración aditiva | La app arranca con el schema viejo; `ALTER TABLE ADD COLUMN` (aditivo) funciona; `ALTER TABLE RENAME COLUMN` rompe todo. |

## Notas / Changelog
- 2026-05-22: nivel pleno (es el contrato de la DB — merece detalle).
