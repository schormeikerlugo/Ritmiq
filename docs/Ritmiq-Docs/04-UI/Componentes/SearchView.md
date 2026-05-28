---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/SearchView/SearchView.jsx
tags: [componente, busqueda, tabs, youtube, artistas, playlists]
---

# `SearchView`

> Vista de búsqueda avanzada con 4 tabs: Todo / Canciones / Artistas / Playlists. Muestra resultados de YouTube + biblioteca local deduplicados, con prewarm al hover y badges de cache.

## Ubicación
`packages/ui/src/components/SearchView/SearchView.jsx:1` (954 líneas — incluye `ExploreView.jsx`)

## Props
Sin props. Recibe la query desde `view.query` del store.

## Tabs

| Tab | Fuente | Dedup |
|---|---|---|
| `'all'` | YouTube + biblioteca | dedupeByYtId |
| `'videos'` | `useSearchStore.videos` | dedupeByYtId |
| `'channels'` | `useSearchStore.channels` | — |
| `'playlists'` | `useSearchStore.playlists` | — |

## Sub-componentes
- `ExploreView` — cuando no hay query activa: muestra explore/categorías.
- [[TrackCard]] (de `Home/`)
- [[ArtistCard]] (de `Home/`)
- `RowSkeleton`

## Stores y helpers consumidos

| Fuente | Uso |
|---|---|
| [[search]] store | `query`, `videos`, `channels`, `playlists`, `loading`, `error`, `fetch`, `fetchMore` |
| [[library]] store | `tracks` (para dedup y matches locales) |
| [[view]] store | `goArtist`, `goBack` |
| [[player]] store | `playNow` |
| [[library-search]] | `searchLibraryTracks`, `dedupeByYtId` |
| [[lan-client]] | `checkSharedCache`, `prewarmStream` |
| [[track-helpers]] | `metaToCandidate` |

## Prewarm en esta vista
Al renderizar los resultados, `prewarmStream(ytId)` se llama para los 2 primeros videos (prioridad 1 — más bajo que el prewarm de TopBar que es 5, porque aquí el usuario todavía está eligiendo).

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Sin `dedupeByYtId` | Tracks de la biblioteca aparecen duplicados: una vez como "En tu biblioteca" y otra vez como resultado de YouTube. |
| `fetchMore` que hace append en lugar de reemplazar | Lista crece con duplicados al paginar. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
- 2026-05-27 (Fase 0.5): click en card de playlist YT (tabs `all` y `playlists`) ahora navega a [[YtPlaylistView]] vía `goYtPlaylist(p.id)` de [[view]] store. Antes hacía `console.info` sin acción. Removidos los TODOs L389+L456. Commit `d585e68`.
