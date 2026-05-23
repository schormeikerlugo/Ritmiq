---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/local-downloads.js
tags: [helper, descargas, indexeddb, dexie, cache, pwa]
---

# `lib/local-downloads.js`

> Gestión de descargas offline en la PWA (y caché de metadata). `RitmiqLocalDB` extiende Dexie con stores para blobs de audio, caché de tracks/playlists y una cola offline de eventos de historial.

## Ubicación
`packages/ui/src/lib/local-downloads.js:1` (333 líneas)

## Export principal

```js
export const db: RitmiqLocalDB   // singleton Dexie
```

## Schema de la DB local (Dexie)

```js
this.version(1).stores({
  audioBlobs:    'trackId',              // { trackId, blob, mime, size, ytId }
  trackCache:    'id, userId, createdAt', // metadata de tracks (offline-first)
  playlistCache: 'id, userId',            // metadata de playlists
  playlistContentsCache: 'playlistId',   // { playlistId, trackIds[] }
  pendingPlays:  '++id, queuedAt',       // cola offline de eventos historial
})
```

## Exports de funciones

### Audio Blobs

| Función | Descripción |
|---|---|
| `isLocallyDownloaded(trackId)` | Booleano — ¿hay blob para este track? |
| `listLocalIds()` | `Set<string>` de todos los trackIds con blob |
| `listLocalDownloads()` | `{ trackId, ytId, size, mime }[]` |
| `getLocalBlobUrl(trackId)` | Crea Object URL del blob (o null) |
| `removeLocal(trackId)` | Borra el blob del store |
| `getLocalSize(trackId)` | Bytes del blob |
| `storageEstimate()` | `{ used, quota }` vía `navigator.storage.estimate()` |
| `downloadTrackToLocal(trackId, onProgress, opts)` | Descarga via LAN/cloud y guarda como Blob |
| `clearAllLocal()` | Borra todos los blobs + caché |

### Cache de metadata

| Función | Descripción |
|---|---|
| `cacheTracks(tracks)` | Persiste array de Track en IndexedDB |
| `getCachedTracks()` | Lee tracks del caché |
| `removeCachedTrack(trackId)` | Borra track del caché |
| `cachePlaylists(playlists)` | Persiste playlists |
| `getCachedPlaylists()` | Lee playlists del caché |
| `cachePlaylistContents(contents)` | Persiste map `{ playlistId: [trackId] }` |
| `getCachedPlaylistContents()` | Lee contents del caché |

## Anatomía del código (snippets clave)

### 1. `downloadTrackToLocal`: cascada LAN → cloud
`packages/ui/src/lib/local-downloads.js:158-253` (approx)

```js
export async function downloadTrackToLocal(trackId, onProgress, opts = {}) {
  const ytId = opts.ytId ?? null;

  // 1. ¿Ya está descargado? → no-op
  if (await isLocallyDownloaded(trackId)) {
    onProgress?.(100);
    return;
  }

  // 2. Intentar vía LAN /download/<trackId> (más rápido que cloud).
  //    El LAN server sirve el archivo completo con paralelismo yt-dlp.
  const baseUrl = await getReachableLanBaseUrl();
  if (baseUrl) {
    try {
      const url = withTokenInUrl(`${baseUrl}/download/${encodeURIComponent(trackId)}?yt=${ytId ?? ''}`);
      const res = await fetch(url);
      if (res.ok && res.body) {
        const blob = await streamToBlob(res, (pct) => onProgress?.(pct));
        await db.table('audioBlobs').put({ trackId, blob, mime: blob.type, size: blob.size, ytId });
        onProgress?.(100);
        return;
      }
    } catch (err) {
      console.warn('[local-downloads] LAN download failed, trying cloud', err?.message);
    }
  }

  // 3. Fallback: Edge Function resolve-stream → fetch del stream y guardar como blob.
  // ...
}
```

**Por qué LAN primero**: el LAN server usa yt-dlp con paralelismo (múltiples conexiones HTTP al mismo host de googlevideo) → descarga 5-10× más rápida que fetch del stream secuencial. En casa con WiFi rápida, un track de 5MB tarda ~2s; vía cloud puede tardar 15s+.

**Por qué guardar como blob y no como file**: la PWA no puede escribir al filesystem del OS. IndexedDB es el único storage persistente disponible en iOS.

### 2. `streamToBlob`: progreso durante la descarga
`packages/ui/src/lib/local-downloads.js:~210-240` (approx)

```js
async function streamToBlob(res, onProgress) {
  const contentLength = Number(res.headers.get('content-length') || 0);
  const chunks = [];
  let received = 0;
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (contentLength > 0) {
      onProgress?.(Math.round((received / contentLength) * 100));
    }
  }
  const mime = res.headers.get('content-type') ?? 'audio/mp4';
  return new Blob(chunks, { type: mime });
}
```

**Por qué Blob y no ArrayBuffer**: un Blob puede ser grande (5-50MB) y el browser lo puede swapear a disco. Un ArrayBuffer vive 100% en RAM y puede generar OOM en dispositivos con poca memoria.

### 3. `getLocalBlobUrl`: Object URL fresh cada llamada
`packages/ui/src/lib/local-downloads.js:108-121`

```js
export async function getLocalBlobUrl(trackId) {
  const row = await db.table('audioBlobs').get(trackId);
  if (!row) return null;
  return URL.createObjectURL(row.blob);
}
```

**Por qué fresh cada vez**: los Object URLs son válidos solo en la sesión actual del navegador. Si la PWA recargó (SW update, hot-reload), los URLs de la sesión anterior son inválidos silenciosamente. Crear fresh garantiza validez. Ver [[dexie-adapter#getLocalUrl]] para la misma decisión.

## Performance y costes de storage

| Operación | Tiempo típico |
|---|---|
| `isLocallyDownloaded(id)` | < 5ms (Dexie key lookup) |
| `listLocalIds()` | < 20ms (full scan de audioBlobs) |
| `downloadTrackToLocal` via LAN | 2-10s (5MB track en WiFi) |
| `downloadTrackToLocal` via cloud | 10-30s (stream sequencial) |
| `storageEstimate()` | < 10ms |

**Límites de IndexedDB en iOS**:
- Safari permite ~50% del espacio libre → con 1GB libre, ~500MB de audio.
- 100 tracks × 5MB promedio = 500MB → cerca del límite en dispositivos con poco espacio.

## Casos de borde

- **Descarga interrumpida a medias**: el blob parcial no se guarda (la store solo persiste cuando `put()` llama al final). Si la conexión cae durante la descarga, hay que reiniciar.
- **Track ya descargado pero `isLocallyDownloaded` devuelve false**: el track existe en `audioBlobs` pero `listLocalIds()` lo perdió por un bug. `downloadTrackToLocal` re-descarga. Idempotente.
- **`clearAllLocal()`**: borra todos los blobs de audio Y el caché de metadata. Después del clear, la app recarga desde Supabase en el siguiente `load()`.

## Dependencias entrantes
- [[api|ui/lib/api]] → `downloadTrackToLocal`, `removeLocal`, `getLocalSize`.
- [[use-player]] → `getLocalBlobUrl` via `buildResolveDeps.getLocalUrl`.
- [[library]] store → `listLocalIds`, `getCachedTracks`, `cacheTracks`.
- [[playlists]] store → `getCachedPlaylists`, `cachePlaylists`, `getCachedPlaylistContents`, `cachePlaylistContents`.
- [[history]] store → `db.table('pendingPlays')` directamente.
- [[dexie-adapter]] (packages/db) → arquitectura similar pero diferente instancia; esta es la DB local UI, no la DB del package de abstracción.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Guardar como ArrayBuffer en lugar de Blob | OOM en dispositivos con < 2GB RAM al descargar tracks grandes. |
| `getLocalBlobUrl` que cachea el Object URL | Object URLs de sesiones anteriores inválidos → play de tracks offline falla silenciosamente. |
| Sin fallback cloud tras fallo LAN | Si el Desktop está apagado, los tracks no se pueden descargar en la PWA. |
| `clearAllLocal` sin borrar caché de metadata | La PWA muestra tracks que ya no tiene offline → isDownloaded desincronizado. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
