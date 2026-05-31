---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/Library/Library.jsx
tags: [componente, biblioteca, playlists, artistas, filtros, pull-to-refresh]
---

# `Library`

> Biblioteca estilo Spotify. Lista unificada de playlists, artistas y tracks descargados con filtros, ordenamiento, búsqueda local y pull-to-refresh.

## Ubicación
`packages/ui/src/components/Library/Library.jsx:1` (394 líneas)

## Props
Sin props.

## Stores y helpers consumidos

| Fuente | Uso |
|---|---|
| [[library]] store | `tracks`, `load`, `loading` |
| [[playlists]] store | `playlists`, `favoritesId`, `contents`, `load`, `loading` |
| [[player]] store | `playNow`, `currentTrack`, `isPlaying` |
| [[view]] store | `goPlaylist`, `goArtist`, `goAccount` |
| [[history]] store | `events`, `selectTopArtists` |
| [[auth]] store | `user` |
| [[play-helpers]] | `playPlaylist`, `playArtistFromLibrary` |
| [[use-pull-to-refresh]] | refresh en mobile |

## Filtros y sorts

| Filtros | Sorts |
|---|---|
| `'playlists'` (default), `'artists'`, `'downloaded'` | `'recent'` (default), `'alpha'`, `'plays'` |

## Comportamiento clave

### Artistas derivados
Derivados del store de `history` vía `selectTopArtists(events)`. No hay tabla de artistas en la DB — se infieren desde el historial de reproducción y la biblioteca de tracks.

### Play overlay activo
La playlist activa muestra un overlay morado pulsante cuando `isPlaying`. Si está pausada, el overlay queda morado sin animación.

### Búsqueda inline
Input en el header (no el TopBar) para búsqueda solo dentro de la biblioteca actual del filtro activo.

### Import Spotify
Botón en el header que abre [[SpotifyImportDialog]]. Solo visible en desktop o si hay LAN/Tunnel disponible (el import requiere el LAN server para resolver tracks en YouTube).

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| `selectTopArtists` sin memoización | Recálculo en cada render → lentitud con historial grande. |
| Filtro `'artists'` sin datos de historial | Lista de artistas vacía aunque haya tracks de artistas en la biblioteca. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
- 2026-05-27 (Fase 4.8): los `<li>` con `item.kind === 'track'` son **draggables** (HTML5 native). `onDragStart` setea `dataTransfer` con MIME `application/x-ritmiq-track` y `rawId`. Drop sobre los playlist items del [[Sidebar]]. Otros kinds (`playlist`, `artist`) NO son draggables. Commit `8a08302`.
- 2026-05-31 (fix anim): el overlay `quickPlay` en estado `data-playing` usaba `quickPlayGlow`
  animando `box-shadow` → tirones en Electron desktop. Migrado a un `::after` con el glow
  estático que anima solo `opacity` + `scale` (GPU). Las `pulseBars` (eq) ya usaban `scaleY`
  y no se tocaron. Ver [[Decisiones-Tecnicas-ADR|ADR-020]].
- 2026-05-31: el filtro **"Descargados"** ahora muestra el resumen [[Downloads|DownloadsSummary]]
  (nº de canciones + peso) en variante `compact`, alimentado por el hook `useDownloadsStats`.
  Es el punto de acceso a descargas en **PWA móvil** (el BottomNav no tiene tab de Descargas).
  Cada fila del filtro incluye el peso de la canción en el subtítulo (`artista · X MB`).
