---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/Home/Home.jsx
tags: [componente, home, historial, recomendaciones, filas]
---

# `Home`

> Pantalla principal estilo Spotify. Filas horizontales de contenido derivado del historial y recomendaciones. Filas con 0 items se ocultan automáticamente.

## Ubicación
`packages/ui/src/components/Home/Home.jsx:1` (321 líneas)

## Props
Sin props.

## Sub-componentes de la carpeta Home

| Componente | Uso |
|---|---|
| `HomeRow` | Contenedor de fila con título + scroll horizontal |
| `TrackCard` | Card de track (cover + título + artista) |
| `ArtistCard` | Card de artista (circular) |
| `HomeStats` | Widget de estadísticas compactas |
| `RowSkeleton` | Skeleton de carga horizontal |

## Stores y selectores consumidos

| Fuente | Uso |
|---|---|
| [[auth]] store | `user` |
| [[social]] store | `profile` (nombre para el saludo) |
| [[library]] store | `tracks` |
| [[playlists]] store | `playlists`, `favoritesId` |
| [[history]] store | `events` + selectores `selectRecentTracks`, `selectTopTracks`, `selectContinueListening`, `selectTopArtists` |
| [[recommendations]] store | `sections`, `fetch` |
| [[player]] store | `playNow` |
| [[view]] store | `goLibrary`, `goPlaylist` |

## Estructura de filas (en orden)

1. **Hero saludo** — `getGreeting()` + nombre del usuario (displayName → username → email).
2. **Continúa escuchando** — `selectContinueListening(events, { limit: 8 })` — tracks con 30s–80% reproducidos.
3. **Tus más escuchados** — `selectTopTracks(events, { days: 30, limit: 12 })`.
4. **Tus artistas** — `selectTopArtists(events, { days: 30, limit: 10 })` — cards circulares.
5. **Tus playlists** — carrusel horizontal de playlists.
6. **Descargados para offline** — `tracks.filter(t => t.isDownloaded).slice(0, 12)`.
7. **Recomendaciones Last.fm** — si hay secciones en `recommendations` store.

## Comportamiento clave

- **Nombre prioridad**: `displayName` > `@username` > local-part del email → el usuario controla cómo aparece en el saludo.
- **Filas con 0 items**: `HomeRow` retorna `null` si `items.length === 0` → no quedan filas vacías.
- **Pull-to-refresh**: refresca historial + biblioteca en mobile.
- **Click en card**: carga la fila completa como cola y reproduce el track clickeado desde su posición (`playNow(rowItems, clickedIdx)`).

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| `selectContinueListening` sin el filtro de ≥30s | Tracks saltados en 5s aparecen en "Continúa escuchando". |
| `useMemo` eliminado de los selectores | Recálculo de 500 eventos en cada render → lag visible. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
