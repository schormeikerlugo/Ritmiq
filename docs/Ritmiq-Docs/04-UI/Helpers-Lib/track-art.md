---
tipo: helper
capa: ui
plataforma: todas
estado: estable
ultima-revision: 2026-11-05
archivo: packages/ui/src/lib/track-art.js
tags: [portadas, ui]
---

# `track-art.js` + `stores/art.js` + `TrackImg`

> Muestra la portada oficial identificada por el servidor ([[Portadas]]) en todas las apps.

## Reglas
1. `coverUrl` que **no** es miniatura de YouTube (elegida a mano, Spotify…) → esa.
2. Canción identificada → portada oficial: en la TV en casa, del propio servidor (`/art/track/<ytId>`, ~10 ms); si no, CDN de Apple/Deezer.
3. Si no → miniatura de YouTube.

## API
- `useTrackCover(track, 300|1000, { priority })`, `useArtistImage(track)`, `coverOf(track, size)` (sin hook: MediaSession), `isYouTubeThumb(url)`.
- `<TrackImg track size priority loading className />`: si la imagen falla vuelve a la miniatura original. `CoverArt` acepta `track`.
- `stores/art.js`: caché memoria + localStorage (2500), consulta `track_art` en lotes de 100; lo que falta se pide al servidor (`artResolve`) y se vuelve a mirar a los 8 s y 25 s.

## Dónde se usa
Barra, Inicio, listas de playlist, cola, búsqueda (también resultados de YouTube del desplegable), artista, descargas, historial, estadísticas, Jam, Reproduciendo (móvil/escritorio, también el color de fondo), pantalla de bloqueo, TV ([[TvNowPlaying]]: fondo = foto del artista, título/artista limpios).

## "Buscar portada"
En **Editar título, artista o portada** (`EditTrackDialog`): candidatos de `/art/candidates`, se elige uno y se guarda como `coverUrl` (manual). "Usar la automática" vuelve a la miniatura de YouTube.

## Notas / Changelog
- 2026-11-05: creación.
