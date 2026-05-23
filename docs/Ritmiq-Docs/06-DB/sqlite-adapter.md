---
tipo: modulo
capa: db
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: packages/db/src/sqlite-adapter.js
tags: [db, sqlite, adapter, cache]
---

# `db/sqlite-adapter.js`

> Adapter SQLite (`better-sqlite3`) para el proceso main de Electron. Expone funciones de alto nivel sobre el schema. **Solo usable en Node** — no importar desde renderer ni PWA.

## Ubicación
`packages/db/src/sqlite-adapter.js:1` (247 líneas)

## Exports

| Función | Tipo | Descripción |
|---|---|---|
| `applySchema(db)` | setup | Ejecuta SCHEMA_SQL + migraciones aditivas + backfill |
| `upsertTrack(db, track)` | mutación | INSERT OR UPDATE de un track |
| `listTracks(db, userId)` | lectura | Todos los tracks de un usuario, desc |
| `registerSharedAudio(db, entry)` | mutación | Indexa un archivo en cache compartido |
| `findSharedAudio(db, ytId)` | lectura + vacuum | Busca por ytId; limpia si el archivo fue borrado |
| `findSharedAudioBulk(db, ytIds)` | lectura | Check bulk (cap 100), devuelve `Set<string>` |
| `sharedAudioStats(db)` | lectura | `{ count, totalBytes }` para Ajustes |
| `clearSharedAudio(db)` | mutación destructiva | Borra archivos + tabla + marca tracks como no-descargados |

## Anatomía del código (snippets clave)

### 1. `applySchema`: boot idempotente + migración aditiva + backfill
`packages/db/src/sqlite-adapter.js:23-31`

```js
export function applySchema(db) {
  db.exec(SCHEMA_SQL);
  // Migración aditiva: añade cover_url a playlists si no existe.
  addColumnIfMissing(db, 'playlists', 'cover_url', 'TEXT');
  // Backfill shared_audio desde tracks ya descargados.
  backfillSharedAudio(db);
}
```

**Por qué `addColumnIfMissing` en lugar de otro `CREATE TABLE IF NOT EXISTS`**: `CREATE TABLE IF NOT EXISTS` maneja tablas nuevas. Para **añadir columnas** a tablas existentes necesitamos `ALTER TABLE ADD COLUMN` — pero solo si la columna no existe ya (las versiones viejas de la app no la tendrían). `addColumnIfMissing` hace el `PRAGMA table_info` + `ALTER TABLE` solo cuando falta.

**Por qué no usar `PRAGMA user_version` para versionar migraciones**: se evaluó y se descartó por simplicidad. Con `IF NOT EXISTS` y `addColumnIfMissing` el schema es completamente idempotente sin contador de versiones. La desventaja: no se puede hacer `DROP COLUMN` ni renombrar — solo añadir.

### 2. `backfillSharedAudio`: pobla el cache al arrancar
`packages/db/src/sqlite-adapter.js:39-72`

```js
function backfillSharedAudio(db) {
  try {
    const rows = db.prepare(`
      SELECT yt_id, file_path FROM tracks
      WHERE is_downloaded = 1 AND yt_id IS NOT NULL AND file_path IS NOT NULL
    `).all();
    // ...solo los que existen en disco...
    const items = [];
    for (const r of rows) {
      if (!existsSync(r.file_path)) continue;
      // mime detection por extensión
      const mime = r.file_path.endsWith('.opus') ? 'audio/ogg' : ...;
      try {
        const size = statSync(r.file_path).size;
        items.push([r.yt_id, r.file_path, mime, size, new Date().toISOString()]);
      } catch { /* skip */ }
    }
    if (items.length) {
      tx(items); // INSERT OR IGNORE — idempotente
    }
  } catch (err) {
    console.warn('[db] shared_audio backfill failed:', err.message);
  }
}
```

**Por qué se ejecuta en CADA arranque**: un usuario que actualiza la app desde una versión sin `shared_audio` tiene archivos en `tracks.file_path` que no están indexados. El backfill los descubre sin intervención del usuario. `INSERT OR IGNORE` hace que las ejecuciones siguientes sean no-ops.

**Por qué `existsSync` por cada fila**: la app puede haber sido desinstalada parcialmente, el disco puede haberse limpiado, etc. Solo indexamos archivos que realmente existen hoy.

### 3. `findSharedAudio`: vacuum oportunista
`packages/db/src/sqlite-adapter.js:101-115`

```js
export function findSharedAudio(db, ytId) {
  if (!ytId) return null;
  const row = db.prepare('SELECT * FROM shared_audio WHERE yt_id = ?').get(ytId);
  if (!row) return null;
  if (!existsSync(row.file_path)) {
    db.prepare('DELETE FROM shared_audio WHERE yt_id = ?').run(ytId);
    return null;
  }
  return { ytId: row.yt_id, filePath: row.file_path, mime: row.mime, size: row.size };
}
```

**Vacuum oportunista**: si alguien borró el archivo a mano (Finder, rm, disco limpio), la row queda stale en `shared_audio`. La próxima vez que busquemos ese `ytId`, limpiamos in-line. No necesitamos un job de mantenimiento.

### 4. `clearSharedAudio`: borra físico + tabla + resync de tracks
`packages/db/src/sqlite-adapter.js:162-177`

```js
export function clearSharedAudio(db) {
  const rows = db.prepare('SELECT yt_id, file_path, size FROM shared_audio').all();
  let removed = 0, freed = 0;
  for (const r of rows) {
    if (r.file_path && existsSync(r.file_path)) {
      try { unlinkSync(r.file_path); removed++; freed += (r.size ?? 0); } catch {}
    }
  }
  db.exec(`
    DELETE FROM shared_audio;
    UPDATE tracks SET is_downloaded = 0, file_path = NULL WHERE is_downloaded = 1;
  `);
  return { removed, freedBytes: freed };
}
```

**Por qué también actualiza `tracks`**: el mismo archivo puede estar referenciado tanto en `shared_audio` como en `tracks.file_path` (ocurre cuando el owner del desktop descargó el track). Limpiar solo `shared_audio` dejaría `tracks` con `is_downloaded=1` apuntando a un archivo que ya no existe. Actualizamos `tracks` para que la UI muestre correctamente el estado offline.

**Limitación**: usa `UPDATE tracks SET is_downloaded = 0` para TODOS los tracks, no solo los que apuntaban a archivos de `shared_audio`. Si algún track tiene un `file_path` que NO está en `shared_audio` (ej. importado localmente), también se marca como no-descargado. Bug conocido, no priorizado para escala actual.

### 5. `upsertTrack`: boolean → integer explícito
`packages/db/src/sqlite-adapter.js:191-214`

```js
export function upsertTrack(db, t) {
  const stmt = db.prepare(`
    INSERT INTO tracks (..., is_downloaded, ...) VALUES (..., @isDownloaded, ...)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      ...
      is_downloaded = excluded.is_downloaded,
      updated_at = excluded.updated_at
  `);
  stmt.run({
    ...t,
    isDownloaded: t.isDownloaded ? 1 : 0,  // boolean → integer
    updatedAt: new Date().toISOString(),
  });
}
```

**Por qué `? 1 : 0` explícito**: `better-sqlite3` no coerciona booleans JS a INTEGER automáticamente. Si se pasa `true`, lo guarda como `1`; pero SQLite trataría `false` como `0` de todas formas. La conversión explícita hace la intención obvia y evita sorpresas si el valor llega como string `"true"`.

## Casos de borde y gotchas

- **`listTracks` incluye tracks borrados localmente** (si el archivo se borró pero `is_downloaded=1` quedó stale): el caller ([[ipc]] `library:list`) confía en `is_downloaded`; la UI mostraría badge "descargado" aunque el file no exista. El fix real es `findSharedAudio` que limpia oportunistamente, pero para `listTracks` no hay chequeo de `existsSync` por performance.
- **`clearSharedAudio` lento con cache grande**: itera con `unlinkSync` por cada archivo. 100+ archivos de 5MB = 500MB+ → puede tardar 1-5 segundos bloqueando el event loop. Mitigación futura: correr en worker_thread.
- **`applySchema` no puede revertir migraciones**: si una versión nueva añade `cover_url` y luego volvemos a una versión vieja, la columna queda ahí (innocua). Si añadimos una columna con constraint NOT NULL sin default, la migración falla en DBs viejas con filas existentes.

## Dependencias entrantes
- [[db|apps/desktop/main/db.js]] → `applySchema`.
- [[ipc]] → `upsertTrack`, `listTracks`, `findSharedAudio`, `registerSharedAudio`, `sharedAudioStats`, `clearSharedAudio`.
- [[lan-server]] → `findSharedAudio`, `registerSharedAudio`, `findSharedAudioBulk`, `sharedAudioStats`, `clearSharedAudio`.

## Dependencias salientes
- [[schema]] (`SCHEMA_SQL`).
- `node:fs` (`existsSync`, `statSync`, `unlinkSync`).
- `better-sqlite3` (instancia inyectada).

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar `backfillSharedAudio` | Usuarios con tracks descargados antes de la feature de cache no los ven en `shared_audio` → re-descarga innecesaria. |
| `clearSharedAudio` sin actualizar `tracks` | UI muestra tracks "descargados" con badge aunque el archivo no exista → play falla silenciosamente. |
| `upsertTrack` sin `? 1 : 0` | Comportamiento dependiente de la versión de better-sqlite3; potencial `true` guardado como string. |
| `findSharedAudio` sin vacuum | Archivos borrados quedan en tabla → falsas promesas de cache hit → copy falla en [[ipc#library:download]]. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
