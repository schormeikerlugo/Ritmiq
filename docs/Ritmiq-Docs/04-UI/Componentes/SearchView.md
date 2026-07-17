---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-07-17
archivo: packages/ui/src/components/SearchView/SearchView.jsx
tags: [componente, busqueda, tabs, youtube, artistas, playlists, persistencia, paginacion]
---

# `SearchView`

> Vista de búsqueda avanzada con 4 tabs: Todo / Canciones / Artistas / Playlists. Muestra resultados de YouTube + biblioteca local, con prewarm y badges de caché. **Desde 2026-07-17**: la búsqueda **persiste** al navegar (hasta que el usuario la limpia), el tab "Canciones" trae **más variedad** (12+ y hasta 30) con **"Ver más"** incremental, y muestra duplicados con badge en vez de ocultarlos.

## Ubicación
`packages/ui/src/components/SearchView/SearchView.jsx:1` (954 líneas — incluye `ExploreView.jsx`)

## Props
Sin props. Recibe la query desde `view.query` del store.

## Tabs

| Tab | Fuente | Dedup / notas |
|---|---|---|
| `'all'` | YouTube + biblioteca | resumen: 5 por franja, dedupeByYtId (no duplica con franjas de arriba) |
| `'videos'` | `videosAsTracksFull` | **lista completa**: NO oculta duplicados, los marca con badge; "Ver más" pagina |
| `'channels'` | `useSearchStore.channels` | `fetchMore('channels')` al abrir (max 30) |
| `'playlists'` | `useSearchStore.playlists` | `fetchMore('playlists')` al abrir (max 30) |

## Persistencia de la búsqueda (2026-07-17)

La búsqueda persiste al navegar fuera y volver, hasta que el usuario la limpia:

- `App.jsx`: **key estable** `'search'` (sin la query) → SearchView no se remonta
  al cambiar de query ni al volver.
- [[search]] store: `activeTab` y `scrollTop` persistentes (antes `useState` local).
- Scroll capturado/restaurado desde el `<main data-main-scroll>`; exceptuado del
  reset forzado de scroll de `App.jsx`.
- Botón **X** del input = "Limpiar búsqueda completa" (`reset()` + `goSearchView()`),
  única forma de borrarla. Ninguna navegación llama `reset()` (solo logout).

## Variedad y "Ver más" (2026-07-17)

- `type=all` trae 12 por tipo (antes 5); el tab dedicado carga max=30 vía `fetchMore`.
- `videosAsTracksFull` = videos sin excluir duplicados; badges "En biblioteca" (♪)
  y "Conocida en Ritmiq" (✨).
- Botón **"Ver más"** al final del tab Canciones → `loadMoreVideos()` (append con
  dedupe por id, usa `videosContinuation`).

## Sub-componentes
- `ExploreView` — cuando no hay query activa: muestra explore/categorías.
- [[TrackCard]] (de `Home/`)
- [[ArtistCard]] (de `Home/`)
- `RowSkeleton`

## Stores y helpers consumidos

| Fuente | Uso |
|---|---|
| [[search]] store | `query`, `videos`, `channels`, `playlists`, `known`, `loading`, `error`, `fetch`, `fetchMore`, `loadMoreVideos`, `activeTab`/`setActiveTab`, `scrollTop`/`setScrollTop`, `videosContinuation`, `loadingMore` |
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
- 2026-07-17: persistencia de búsqueda (key estable + tab/scroll en store + botón limpiar); más variedad (12/30) con "Ver más" incremental; tab Canciones muestra duplicados con badge. Ver [[search-youtube]], [[Cache-y-Rendimiento]]. Commits `d5ba010`, `9ce7ab5`.
- 2026-05-22: nivel pleno.
- 2026-05-27 (Fase 0.5): click en card de playlist YT (tabs `all` y `playlists`) ahora navega a [[YtPlaylistView]] vía `goYtPlaylist(p.id)` de [[view]] store. Antes hacía `console.info` sin acción. Removidos los TODOs L389+L456. Commit `d585e68`.
