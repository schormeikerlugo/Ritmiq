---
tipo: modulo
capa: db
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/db/src/dexie-adapter.js
tags: [db, dexie, indexeddb, pwa]
---

# `db/dexie-adapter.js`

> Adapter IndexedDB (Dexie v3) para la PWA. Almacena metadata de tracks, playlists, historial, blobs de audio descargados y cola de sync. **Solo usado en browser** — no importar en Node.

## Ubicación
`packages/db/src/dexie-adapter.js:1` (56 líneas)

## Por qué Dexie

IndexedDB nativo es verboso y callback-based. Dexie provee una API Promises + queries con operadores (`where`, `equals`, `anyOf`). Además maneja versionado de schema con `db.version(N).stores(...)`.

## Clase `RitmiqDexie`

Extiende `Dexie`. Singleton en la PWA (una sola instancia por app).

## Schema de stores (v1)

```js
this.version(1).stores({
  tracks:        'id, userId, ytId, isDownloaded, createdAt',
  playlists:     'id, userId, createdAt',
  playlistTracks: '[playlistId+trackId], playlistId, trackId, position',
  playHistory:   'id, userId, trackId, playedAt',
  audioBlobs:    'trackId',   // { trackId, blob, mime, size }
  syncQueue:     'id, createdAt',
});
```

**Claves e índices** (Dexie usa el primer campo como PK, el resto como índices):

| Store | PK | Índices secundarios |
|---|---|---|
| `tracks` | `id` | `userId`, `ytId`, `isDownloaded`, `createdAt` |
| `playlists` | `id` | `userId`, `createdAt` |
| `playlistTracks` | `[playlistId+trackId]` (compuesto) | `playlistId`, `trackId`, `position` |
| `playHistory` | `id` | `userId`, `trackId`, `playedAt` |
| `audioBlobs` | `trackId` | — |
| `syncQueue` | `id` | `createdAt` |

## API

```js
putTrack(track: Track): Promise<void>
listTracks(userId: string): Promise<Track[]>
getLocalUrl(trackId: string): Promise<string | null>   // blob: URL o null
storeAudioBlob(trackId, blob: Blob): Promise<void>
```

## Anatomía del código (snippet clave)

### `getLocalUrl`: object URL fresh por cada llamada
`packages/db/src/dexie-adapter.js:41-45`

```js
async getLocalUrl(trackId) {
  const row = await this.table('audioBlobs').get(trackId);
  if (!row) return null;
  return URL.createObjectURL(row.blob);
}
```

**Por qué crear un object URL nuevo en cada llamada en lugar de cachear**: los object URLs son referencias al blob en memoria del browser. Si la PWA hace hot-reload o el SW se reinicia, los URLs creados en la sesión anterior son inválidos silenciosamente — el `<audio>` los acepta pero falla al cargar. Creándolo fresh, garantizamos que el URL es válido para la sesión actual.

**Leak potencial**: cada `URL.createObjectURL` debe ser revocado con `URL.revokeObjectURL` cuando ya no se necesita. Si el caller ([[audio-source]] → [[html-audio-backend]]) no revoca, el Blob queda en memoria indefinidamente. En una sesión de 30 tracks = 30 Blobs × ~5MB = ~150MB sin liberar. El cleanup es responsabilidad del backend de audio al reemplazar la fuente.

## Relación con [[sqlite-adapter]]

| Aspecto | SQLite (desktop) | Dexie (PWA) |
|---|---|---|
| Runtime | Node (`better-sqlite3`) | Browser (IndexedDB) |
| Sincronía | Síncrono | Async (Promises) |
| Audio offline | `file_path` en disco | `Blob` en `audioBlobs` store |
| Cache compartido | `shared_audio` table | No existe (cada usuario es su propio desktop) |
| Sync queue | `sync_queue` table | `syncQueue` store |
| `devices` / `pair_requests` | Presentes | No presentes (solo en desktop) |

## Casos de borde y gotchas

- **Primera instalación**: Dexie crea la DB automáticamente. No hay paso de setup manual.
- **Versión de schema**: solo `version(1)`. Si en el futuro añadís un store o índice, incrementar a `version(2).stores({...})`. Dexie migra automáticamente en el navegador.
- **IndexedDB en Safari private mode**: la DB se resetea al cerrar la pestaña. Los blobs de audio descargados en privado se pierden — comportamiento del navegador, no del código.
- **Blobs grandes en IndexedDB**: un track de 5MB como Blob consume 5MB de IndexedDB. El límite típico es 50% del espacio libre del dispositivo. En iPhone con 1GB libre → ~500MB disponibles para blobs. 100 tracks × 5MB = 500MB — límite real.

## Dependencias entrantes
- [[local-downloads|ui/lib/local-downloads]] — `storeAudioBlob`, `getLocalUrl`.
- [[audio-source|core/audio-source]] vía `deps.getLocalUrl` construido con `dexie.getLocalUrl`.
- [[sync-queue|ui/lib/sync-queue]] — usa `db.syncQueue` directamente.

## Dependencias salientes
- `dexie` (npm).

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Cambiar `version(1)` sin migración | Dexie tira error de upgrade en browsers que ya tienen la DB v1. |
| Cachear el object URL entre llamadas | Object URLs de sesión anterior inválidos → play de tracks offline silenciosamente falla. |
| Cambiar la PK de `audioBlobs` de `trackId` a `id` | `getLocalUrl(trackId)` ya no encuentra el blob → siempre devuelve null. |
| Olvidar `URL.revokeObjectURL` en el backend de audio | Memory leak de Blobs en sesiones largas. |

## Notas / Changelog
- 2026-05-22: nivel medio.
