---
tipo: modulo
capa: desktop-main
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: apps/desktop/main/db.js
tags: [desktop, db, sqlite]
---

# `main/db.js`

> Inicializa la base de datos SQLite local del desktop usando `better-sqlite3` y aplica el schema compartido de [[schema|packages/db]].

## Ubicación
`apps/desktop/main/db.js:1` (11 líneas)

## Firma

```js
function initDb(): import('better-sqlite3').Database
```

## Anatomía del código (archivo completo)

`apps/desktop/main/db.js:1-11`

```js
import { app } from 'electron';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { applySchema } from '@ritmiq/db/sqlite';

export function initDb() {
  const path = join(app.getPath('userData'), 'ritmiq.sqlite');
  const db = new Database(path);
  applySchema(db);
  return db;
}
```

**Por qué `applySchema` aquí**: el schema vive en [[schema]] (capa `db`) y se aplica idempotente con `CREATE TABLE IF NOT EXISTS …`. Llamarlo en cada arranque garantiza que un usuario con DB vieja reciba las tablas nuevas sin pasos manuales. Las migraciones de datos (no schema) se manejan dentro de `applySchema` con `PRAGMA user_version`.

**Por qué `better-sqlite3` y no `sqlite3`**: `better-sqlite3` es **sincrónico** y 10× más rápido para queries pequeñas. Encaja con un reproductor de música donde la mayoría de queries son < 1ms y bloquear el event loop durante ese tiempo es invisible al usuario. Coste: queries pesadas (full library scan con joins) bloquean el thread; mitigarlo con índices apropiados en [[schema]].

## Path resultante

| OS | Ruta típica |
|---|---|
| Linux | `~/.config/Ritmiq/ritmiq.sqlite` |
| macOS | `~/Library/Application Support/Ritmiq/ritmiq.sqlite` |
| Windows | `%APPDATA%/Ritmiq/ritmiq.sqlite` |

## Dependencias entrantes
- [[index|main/index.js]] al arrancar — única invocación.

## Dependencias salientes
- `better-sqlite3` (binding nativo, requiere `pnpm rebuild better-sqlite3` tras cambios de versión Electron).
- [[schema|@ritmiq/db/sqlite#applySchema]].
- `electron.app.getPath('userData')`.

## Side-effects
- Crea/abre archivo en disco.
- Ejecuta DDL idempotente.

## Errores manejados
- Ninguno explícito — propaga. El caller ([[index]]) hace que un crash aquí sea fatal: sin DB no hay app.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Cambiar el path a uno relativo | DB diferente según `cwd` → usuario pierde su biblioteca al lanzar la app desde otro directorio. |
| Olvidar `applySchema(db)` | Las tablas nuevas no existen → todos los handlers IPC que leen tracks/playlists tiran error `no such table`. |
| Cambiar a `sqlite3` async sin actualizar todos los call-sites | Compatibilidad: las queries sync de `ipc.js` y `devices.js` se romperían porque devolverían Promises en lugar de filas. |

## Notas

- La instancia `db` es **compartida** entre IPC y LAN server. Es seguro porque `better-sqlite3` serializa internamente.
- Para WAL mode (mejor concurrencia lectura) habría que añadir `db.pragma('journal_mode = WAL')` aquí. No activado: tráfico bajo no lo justifica.

## Notas / Changelog
- 2026-05-22: nivel simple.
