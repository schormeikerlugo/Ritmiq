---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-08-11
archivo: packages/ui/src/stores/downloads.js
tags: [store, descargas, cola, concurrencia, toast]
---

# `stores/downloads.js`

> Cola de descargas con concurrencia `CONCURRENCY = 2`. Gestiona el ciclo `queued → running → done/error` para desktop (IPC a disco) y PWA (blob a IndexedDB). Muestra el panel `DownloadProgress`.

## Ubicación
`packages/ui/src/stores/downloads.js:1` (111 líneas)

## Tipo `DLEntry`

```js
{
  trackId: string,
  title: string,
  status: 'queued' | 'running' | 'done' | 'error',
  progress: number,   // 0..100
  error?: string,
}
```

## Estado

```js
{
  entries: DLEntry[],
  visible: boolean,    // muestra/oculta la píldora de progreso
  _notified: boolean,  // interno: ¿ya se emitió el toast-resumen de la tanda?
}
```

## Acciones

| Acción | Descripción |
|---|---|
| `enqueue(tracks)` | Agrega tracks no descargados y no en cola. Abre el panel. Llama `pump()`. |
| `hide()` | Oculta el panel (las descargas siguen corriendo). |
| `clearFinished()` | Elimina entradas `done` y `error`. |

## Anatomía del código (snippets clave)

### 1. Listener de progreso: singleton con flag
`packages/ui/src/stores/downloads.js:16-30`

```js
let installedListener = false;

function ensureProgressListener(set, get) {
  if (installedListener) return;
  installedListener = true;
  api.libraryOnDownloadProgress(({ trackId, pct }) => {
    set((s) => ({
      entries: s.entries.map((e) =>
        e.trackId === trackId && e.status === 'running'
          ? { ...e, progress: pct }
          : e
      ),
    }));
  });
}
```

**Por qué el flag de módulo**: el listener de progreso del IPC Desktop (`preload.library.onDownloadProgress`) debe instalarse una sola vez globalmente. Si `enqueue` se llama múltiples veces, sin el flag se acumularían N listeners emitiendo N veces por cada evento de progreso.

**Por qué `status === 'running'`**: si llega un evento de progreso para un trackId que ya está `done` (race condition entre el evento final del IPC y el `set({ status: 'done' })`), lo ignoramos.

### 2. `pump`: concurrencia con `CONCURRENCY = 2`
`packages/ui/src/stores/downloads.js:67-82`

```js
async function pump(set, get) {
  const running = get().entries.filter((e) => e.status === 'running').length;
  const slots = CONCURRENCY - running;
  if (slots <= 0) return;

  const queued = get().entries.filter((e) => e.status === 'queued').slice(0, slots);
  for (const entry of queued) {
    set(/* marcar running */);
    runOne(entry.trackId, set, get);  // fire-and-forget
  }
}
```

**Por qué 2 descargas simultáneas**: más de 2 saturan la conexión de la PWA (si está vía WiFi/LAN) o saturan yt-dlp en el desktop. Menos de 2 desperdicia banda disponible. 2 es el sweet spot empírico.

### 3. `runOne`: fallback con fila completa en desktop
`packages/ui/src/stores/downloads.js:88-93`

```js
let payload = trackId;
if (isDesktop) {
  const t = useLibraryStore.getState().tracks.find((x) => x.id === trackId);
  if (t) payload = { trackId, fallback: t };
}
await api.libraryDownload(payload);
```

**Por qué pasar `fallback` en desktop**: tracks importados de Spotify están en Supabase pero pueden no estar replicados aún en SQLite local. El IPC handler `library:download` acepta `{ trackId, fallback }` y usa el fallback para sincronizar la fila antes de descargar. Ver [[ipc#library:download]].

### 4. Notificación AGRUPADA de completado (2026-08)

Antes `runOne` emitía `toast.success("X descargada")` **por cada track** → spam
al descargar varias. Ahora el toast se saca del bucle y se emite **uno solo al
terminar la tanda**:

- `pump()` detecta `running === 0 && queued === 0`; si hay entries y no se
  notificó (`_notified`), llama `notifyBatchComplete(get)` y marca `_notified`.
- `notifyBatchComplete`: 1 track → `"X descargada"`; lote → `"N canciones
  descargadas"`; con fallos → `"N descargadas · M fallaron"`.
- `enqueue` limpia la tanda previa ya terminada (todos done/error) y resetea
  `_notified`, para que el resumen cuente solo la tanda actual.

Ver [[toast]] (max 3 FIFO, sin dedup nativo — por eso el agrupado se hace aquí).

## Casos de borde

- **Misma descarga encolada dos veces**: `enqueue` filtra por `existing Set(entries.map(e.trackId))`. La segunda llamada es no-op.
- **Track ya descargado**: `enqueue` filtra `!t.isDownloaded`. Si el estado de `isDownloaded` está desactualizado en el store, puede colarse. El IPC lo detectaría y sobrescribiría el archivo.
- **`pump` llamado desde `finally` de `runOne`**: si `runOne` termina (done o error), `pump` intenta iniciar el siguiente queued. Nunca hay más de `CONCURRENCY` en `running` simultáneamente.

## Dependencias entrantes
- [[library]] store → `download(trackId)` llama `enqueue`.
- [[playlists]] store → `setOffline` y `addTrack` llaman `enqueueOfflineDownload`.

## Dependencias salientes
- [[api|ui/lib/api]] → `libraryDownload`, `libraryOnDownloadProgress`.
- [[library]] store → `load()` tras `done`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar el flag `installedListener` | N listeners acumulados → progreso se emite N veces → barra salta al instante de 0 a 100. |
| `CONCURRENCY = 10` | Saturación de banda y yt-dlp → descargas lentas y timeouts. |
| Quitar `fallback` en desktop | Tracks importados de Spotify no se pueden descargar hasta que Realtime los replique a SQLite. |

## Notas / Changelog
- 2026-05-22: nivel medio.
