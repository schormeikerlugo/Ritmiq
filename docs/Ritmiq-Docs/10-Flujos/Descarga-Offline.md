---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [flujo, descarga, offline, cache-compartido]
---

# Descarga offline de un track

> Flujo de descarga en Desktop (archivo en disco) y PWA (Blob en IndexedDB). Cubre el cache compartido `shared_audio` que evita re-descargar tracks ya guardados.

## Diagrama

```mermaid
sequenceDiagram
  participant U as Usuario
  participant UI as Library/Player
  participant LS as library store
  participant DS as downloads store
  participant API as ui/lib/api
  participant IPC as IPC main
  participant SQ as SQLite
  participant SC as shared_audio
  participant FS as Disco
  participant YT as yt-dlp

  U->>UI: click descargar
  UI->>LS: download(trackId)
  LS->>DS: enqueue([track])
  DS->>DS: pump() — slots libres CONCURRENCY=2
  DS->>API: libraryDownload(trackId)
  alt Desktop
    API->>IPC: library:download
    IPC->>SQ: SELECT tracks WHERE id
    IPC->>SC: findSharedAudio(yt_id)
    alt cache hit
      SC-->>IPC: filePath (otra cuenta ya lo descargó)
      IPC->>FS: copyFileSync → audio/<id>.m4a
      IPC->>SQ: UPDATE is_downloaded=1
      IPC-->>API: finalPath
    else cache miss
      IPC->>YT: downloadAudio(yt_id, opus)
      YT-->>IPC: stream + onProgress
      IPC-->>API: 'library:download:progress' events
      API-->>DS: progreso → setEntry
      IPC->>FS: archivo final
      IPC->>SQ: UPDATE is_downloaded=1
      IPC->>SC: registerSharedAudio(yt_id, path)
      IPC-->>API: finalPath
    end
  else PWA
    API->>API: downloadTrackToLocal(trackId, onProgress)
    API->>LS_LAN: GET /download/<id>?yt=<ytId>
    LS_LAN-->>API: stream con Range
    API->>API: Blob via streamToBlob + Dexie put
    API-->>DS: progreso
  end
  DS->>LS: load() — refresca isDownloaded
  UI-->>U: badge "offline" visible
```

## Decisiones críticas

- **Cache `shared_audio` PRIMERO** ([[ipc#library:download]]) — si otra cuenta ya lo descargó, copy + UPDATE en ~50ms.
- **Coalescing en `lan-server`** ([[lan-server#downloadSharedAudio]]) — múltiples PWAs piden el mismo ytId → un solo yt-dlp.
- **Formato según destino**: Desktop usa opus (Chromium decode), PWA usa m4a (iOS Safari).
- **Smart Download** ([[playlists#addTrack]]) — si la playlist es offline, encola automáticamente al añadir track.

## Casos de borde documentados

- Track importado de Spotify (no en SQLite local) → IPC acepta `{ trackId, fallback }` para sync antes de descargar.
- Cache shared apunta a archivo borrado → `existsSync` guard → fallback a yt-dlp.
- Descarga interrumpida → blob parcial no se guarda (solo al final).

## Módulos involucrados

- UI: [[Library]], [[Downloads]], [[DownloadIndicator]], [[DownloadProgress]].
- Estado: [[downloads]] store, [[library]] store.
- API: [[api]] adapter.
- Desktop: [[ipc]], [[lan-server]], [[ytdlp-wrapper]], [[schema]] (`shared_audio`).
- PWA: [[local-downloads]], [[dexie-adapter]].

## Notas / Changelog
- 2026-05-22: F8.
