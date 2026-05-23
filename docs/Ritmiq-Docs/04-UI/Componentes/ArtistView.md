---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/ArtistView/ArtistView.jsx
tags: [componente, artista, last-fm, edge-function, discografia]
---

# `ArtistView`

> Página de artista estilo Spotify. Header con imagen grande + gradiente, top tracks, discografía en grid. Datos cargados vía Edge Function `artist-detail` (Last.fm + Innertube, cache server-side 24h).

## Ubicación
`packages/ui/src/components/ArtistView/ArtistView.jsx:1` (534 líneas)

## Props
Sin props. Lee `view.artist` del store.

## Stores consumidos

| Store | Uso |
|---|---|
| [[artist]] store | `fetch(name)`, `resolveAlbum(artist, album)`, `saveAlbumAsPlaylist`, `details[name]`, `albums[key]`, `saves[key]` |
| [[player]] store | `playNow` |
| [[view]] store | `view`, `goBack`, `goAlbum` |

## Estructura

```
Header: imagen artista + nombre + tags + oyentes mensuales
        [▶ Reproducir]  [+ Guardar discografía]
Top tracks: lista vertical reproducible
Discografía: grid de álbumes → click → AlbumView
Bio: texto + tags Last.fm
```

## Comportamiento clave

- **Datos lazy**: `fetch(name)` solo si `details[name]` no existe (cache en memoria de sesión + cache server-side 24h).
- **Top tracks reproducibles**: `playNow(topTracks, clickedIdx)`.
- **"Guardar discografía"**: `artist.saveAlbumAsPlaylist` crea playlist `Artista – Álbum` con todos los tracks del álbum persistidos en Supabase.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| `fetch` sin cache en memoria | Cada vista de artista hace una llamada a la Edge Function → quota agotada. |

## Notas / Changelog
- 2026-05-22: nivel medio.
