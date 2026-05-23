---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/AlbumView/AlbumView.jsx
tags: [componente, album, artista, tracklist, playlist]
---

# `AlbumView`

> Página dedicada de álbum. Cover grande + metadatos, lista numerada de tracks, "Guardar como playlist", "Otros álbumes del artista". Datos via Edge Function `album-resolve` (cache server-side 7 días).

## Ubicación
`packages/ui/src/components/AlbumView/AlbumView.jsx:1` (504 líneas)

## Props
Sin props. Lee `view.artist` y `view.album` del store.

## Stores consumidos

| Store | Uso |
|---|---|
| [[artist]] store | `resolveAlbum(artist, album)`, `saveAlbumAsPlaylist`, `albums[key]`, `saves[key]` |
| [[player]] store | `playNow`, `playNext`, `enqueue` |
| [[view]] store | `view`, `goBack`, `goArtist`, `goAlbum` |

## Comportamiento clave

- **Tracklist numerada**: posición 1..N + cover + título + duración.
- **Prewarm on hover**: `prewarmStream(ytId)` con prioridad 5 al pasar el mouse sobre un track.
- **"Guardar como playlist"**: delega a `artist.saveAlbumAsPlaylist` que serializa los tracks en Supabase con mutex por yt_id (ver [[artist#saveAlbumAsPlaylist]]).
- **"Otros álbumes"**: grid de thumbnails del artista que ya están en `details[artist].albums` (sin re-fetch).
- **Progreso de guardado**: `saves[key].progress` — barra de progreso `0..100` por track.

## Notas / Changelog
- 2026-05-22: nivel medio.
