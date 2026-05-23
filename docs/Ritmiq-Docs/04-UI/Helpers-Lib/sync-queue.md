---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/sync-queue.js
tags: [helper, sync, cola, offline, localStorage]
---

# `lib/sync-queue.js`

> Cola FIFO de mutaciones fallidas persistida en localStorage. Procesa en orden, para al primer fallo, descarta tras 8 intentos. Expone `tryOrQueue` como helper de uso general.

## Ubicación
`packages/ui/src/lib/sync-queue.js:1` (159 líneas)

## Exports

| Export | Descripción |
|---|---|
| `enqueue(op)` | Añade una op a la cola. |
| `flushQueue()` | Procesa FIFO hasta vaciar o primer fallo. |
| `tryOrQueue(fn, op)` | Intenta `fn()`; si falla por red, encola `op`. |
| `queueSize()` | Número de ops pendientes. |
| `onQueueSizeChange(cb)` | Listener del tamaño (para badge/indicator en UI). |

## Ops soportadas

| kind | payload |
|---|---|
| `track.upsert` | `Track` |
| `track.delete` | `{ id }` |
| `playlist.upsert` | `Playlist` |
| `playlist.delete` | `{ id }` |
| `playlist_track.add` | `{ playlistId, trackId, position }` |
| `playlist_track.remove` | `{ playlistId, trackId }` |
| `playlist_track.reorder` | `{ playlistId, orderedTrackIds }` |

## Anatomía del código (snippet clave)

### `tryOrQueue`: el helper más usado
`packages/ui/src/lib/sync-queue.js:138-148`

```js
export async function tryOrQueue(fn, op) {
  try {
    return await fn();
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue(op);
      return null;
    }
    throw err;  // error no-red → propaga (validación, FK, etc.)
  }
}
```

**Por qué distinguir errores de red de otros errores**: un error de FK (`23503`) debe propagarse al caller (es un bug del código, no red caída). Un error de red debe encolar silenciosamente. `isNetworkError` detecta `'failed to fetch'`, `'network'`, `TypeError`, `ECONNREFUSED`.

### `flushQueue`: para en primer fallo
`packages/ui/src/lib/sync-queue.js:75-106`

```js
try {
  await applyOp(op);
  ops = ops.slice(1);
  write(ops);
  applied++;
} catch (err) {
  op.attempts = (op.attempts ?? 0) + 1;
  if (op.attempts >= MAX_ATTEMPTS) {
    console.warn('[sync-queue] descartada tras max attempts', op, err);
    ops = ops.slice(1);  // descartar tras 8 intentos
  }
  write(ops);
  break;  // para el loop
}
```

**Por qué parar en primer fallo (break)**: las ops FIFO pueden tener dependencias. Si el op#3 falla (FK viola porque op#2 no llegó), op#4 probablemente también fallará. Continuar sería crear estado inconsistente en Supabase.

## KEY localStorage

```
ritmiq:syncQueue  →  JSON array de SyncOp
```

Persistente entre sesiones. Sobrevive cierres del browser.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Procesar en paralelo en lugar de FIFO secuencial | Ops sin orden → FK violations si playlist.add llega antes de playlist.create. |
| `tryOrQueue` que propaga todos los errores | Mutación offline sin red = error visible al usuario, sin persistencia. |
| `MAX_ATTEMPTS = 1` | Una falla transitoria descarta la op para siempre. |

## Notas / Changelog
- 2026-05-22: nivel medio.
