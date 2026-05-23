---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [flujo, import, spotify, matching, concurrencia]
---

# Importar playlist de Spotify

> Sin OAuth: parseamos el embed público de Spotify, matcheamos cada track en YouTube via ytSearch, y persistimos en Supabase con mutex por `yt_id`.

## Diagrama

```mermaid
sequenceDiagram
  participant U as Usuario
  participant UI as SpotifyImportDialog
  participant IS as import store
  participant LC as lan-client
  participant LS as lan-server
  participant Spotify as embed.spotify.com
  participant API as ui/lib/api
  participant SB as Supabase
  participant Pls as playlists store

  U->>UI: pega URL Spotify
  UI->>IS: preview(url)
  IS->>LC: lanSpotifyPlaylist(url)
  LC->>LS: GET /spotify/playlist?url=
  LS->>Spotify: fetch embed HTML
  Spotify-->>LS: HTML con tracks
  LS->>LS: parse name + tracks[]
  LS-->>IS: { name, description, tracks }
  IS-->>UI: items: pending[]

  U->>UI: click "Importar"
  UI->>IS: import()
  IS->>Pls: create(name) → playlist destino
  IS->>IS: 2 workers paralelos compartiendo cursor++

  par worker 1
    IS->>API: ytSearch("artista título Topic")
    API->>LS: GET /yt/search?q=
    LS-->>API: items
    IS->>IS: best = topic match || items[0]
    IS->>IS: persistByYtId(best) [mutex global]
    Note over IS: SELECT existing → INSERT con randomId → handle 23505
    IS->>SB: INSERT tracks (idempotente)
    IS->>SB: UPSERT playlist_tracks (position = idx)
    IS->>IS: updateItem(idx, persisted)
  and worker 2
    IS->>API: ytSearch otro track
    IS->>IS: persistByYtId (mismo Map mutex global)
    IS->>SB: INSERT
    IS->>SB: UPSERT playlist_tracks
  end

  IS->>Pls: load() → refrescar
  IS-->>UI: done = true → navegar a la playlist
```

## Decisiones documentadas

- **Sin OAuth Spotify** — parseamos el embed público en el [[lan-server]] (server-side para evitar CORS). Funciona con cualquier URL de share.
- **Sufijo "Topic"** en search ([[import]]) — prioriza canales oficiales de música.
- **Mutex global por `yt_id`** (`persistInflight` Map) — dos workers con mismo ytId → una sola INSERT.
- **Handler de 23505** — race entre el SELECT y el INSERT → re-leer el ganador en lugar de fallar.
- **CONCURRENCY=2** — balance entre velocidad (~100 tracks en 5 min) y rate limit de YouTube.
- **`cursor++` atómico** — JS single-threaded garantiza que ningún worker procese el mismo índice.

## Módulos involucrados

- UI: [[SpotifyImportDialog]].
- Estado: [[import]] store, [[playlists]] store, [[library]] store.
- Red: [[lan-client]] (`lanSpotifyPlaylist`), [[lan-server]] (`/spotify/playlist`).
- API: [[api|ui/lib/api]] (`ytSearch`, `libraryAddFromMeta`).
- DB: [[tracks]], [[playlists]].

## Notas / Changelog
- 2026-05-22: F8.
