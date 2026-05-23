---
tipo: modulo
capa: core
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/core/src/sync/index.js
tags: [core, sync, offline, cola]
---

# `core/sync/index.js`

> Clase `SyncEngine`: cola offline-first de mutaciones. Serializa operaciones en storage persistente cuando no hay red; las reproduce en orden FIFO contra el servidor al reconectarse. Política de conflictos: last-write-wins por `clientUpdatedAt`.

## Ubicación
`packages/core/src/sync/index.js:1` (88 líneas)

## Por qué existe

La PWA puede estar sin red (avión, WiFi débil). Sin cola, cualquier "agregar track" o "crear playlist" se perdería silenciosamente. Con la cola, las operaciones se guardan en IndexedDB (via [[dexie-adapter]] o [[sync-queue|ui/lib/sync-queue]]) y se aplican a Supabase cuando vuelve la conexión.

## Tipos

```js
/**
 * @typedef {Object} SyncOp
 * @property {string}  id                UUID local
 * @property {string}  table             'tracks' | 'playlists' | 'playlist_tracks'
 * @property {'insert'|'update'|'delete'} op
 * @property {Record<string, unknown>} payload
 * @property {string}  clientUpdatedAt   ISO timestamp
 * @property {number}  attempts          Reintentos fallidos
 */
```

```js
/**
 * @typedef {Object} SyncStorage
 * @property {() => Promise<SyncOp[]>}                    list
 * @property {(op: SyncOp) => Promise<void>}              push
 * @property {(id: string) => Promise<void>}              remove
 * @property {(id: string, n: number) => Promise<void>}   bumpAttempts
 */
```

```js
/**
 * @typedef {Object} SyncTransport
 * @property {(op: SyncOp) => Promise<void>} apply  Lanza si falla
 */
```

## API de `SyncEngine`

```js
class SyncEngine {
  constructor({ storage: SyncStorage, transport: SyncTransport, isOnline: () => boolean })

  async enqueue(partial): Promise<void>  // encola op, flush si hay red
  async flush(): Promise<void>           // procesa cola hasta vaciarla o primer fallo
}
```

## Anatomía del código (snippets clave)

### 1. `enqueue`: encolar + flush oportunista
`packages/core/src/sync/index.js:53-65`

```js
async enqueue(partial) {
  const op = {
    id: crypto.randomUUID(),
    attempts: 0,
    clientUpdatedAt: partial.clientUpdatedAt ?? new Date().toISOString(),
    table: partial.table,
    op: partial.op,
    payload: partial.payload,
  };
  await this.storage.push(op);
  if (this.isOnline()) this.flush().catch(() => {});
}
```

**Por qué `flush().catch(() => {})`**: si el flush falla (red inestable), no queremos que `enqueue` rechace — la op ya está guardada y se procesará en el próximo intento. El error de red es esperado y manejable por el polling de `flush`.

**Por qué `clientUpdatedAt` en la op**: la política de conflictos last-write-wins depende de este timestamp. Si dos clientes modifican el mismo recurso, el servidor mantiene el más reciente por `clientUpdatedAt`.

### 2. `flush`: FIFO secuencial hasta primer fallo
`packages/core/src/sync/index.js:70-87`

```js
async flush() {
  if (this._running) return;  // evitar re-entrant concurrent flush
  this._running = true;
  try {
    const ops = await this.storage.list();
    for (const op of ops) {
      try {
        await this.transport.apply(op);
        await this.storage.remove(op.id);
      } catch (err) {
        await this.storage.bumpAttempts(op.id, op.attempts + 1);
        throw err;  // detiene el loop — no saltamos ops fallidas
      }
    }
  } finally {
    this._running = false;
  }
}
```

**Por qué detener en el primer fallo (`throw err`)**: las ops están ordenadas por `createdAt` (FIFO). Si la op #3 falla, las ops #4 y #5 probablemente dependen de ella (ej. agregar un track a una playlist antes de crear la playlist → error de FK). Saltarlas crearía estado inconsistente en el servidor.

**Por qué `this._running` guard**: si la red vuelve y el usuario abre la app dos veces (o hay múltiples paths que llaman `flush`), evitamos dos procesos de flush corriendo en paralelo con el mismo set de ops.

**Limitación conocida**: no hay retry con backoff. Si Supabase está caído, `enqueue` intentará flush inmediato y fallará, incrementando `attempts`. El retry real ocurre la próxima vez que `isOnline()` cambia a `true` — que es responsabilidad del caller escuchar. Ver [[sync-queue]] para la implementación en la UI.

## Casos de borde y gotchas

- **`flush` sin ops**: `list()` devuelve `[]`, el loop no itera, `_running` vuelve a false. Operación barata.
- **Op con `attempts` alto (> 5)**: no hay max_attempts implementado aquí. Si la op es inválida (FK violada, schema mismatch), quedará en cola indefinidamente. El caller ([[sync-queue]]) debería filtrar ops con demasiados intentos.
- **`clientUpdatedAt` en el futuro**: si el reloj del cliente está adelantado, last-write-wins favorece siempre al cliente aunque haya escritura posterior del servidor. Problema conocido, no resuelto.
- **Cola grande (> 100 ops)**: `list()` las carga todas en RAM. Para uso doméstico aceptable. Si alguna vez crece, añadir paginación o límite.

## Dependencias entrantes
- [[sync-queue|ui/lib/sync-queue]] — implementa `SyncStorage` sobre IndexedDB/localStorage y conecta `isOnline` a eventos de red.
- [[sync|ui/lib/sync]] — orquesta `SyncEngine` con el cliente Supabase como `transport`.

## Dependencias salientes
- `crypto.randomUUID()` (disponible en browsers modernos y Node 18+).
- `SyncStorage` y `SyncTransport` inyectados.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Cambiar FIFO por LIFO | Ops aplicadas en orden incorrecto → FK violations en servidor. |
| Quitar `_running` guard | Dos flush simultáneos procesan las mismas ops → duplicados en Supabase. |
| `flush` que no lanza al primer fallo | Op fallida se salta, ops dependientes se aplican sin su prerequisito → estado inconsistente. |
| Quitar `clientUpdatedAt` | Conflictos resueltos arbitrariamente en el servidor → datos perdidos. |

## Notas / Changelog
- 2026-05-22: nivel medio.
