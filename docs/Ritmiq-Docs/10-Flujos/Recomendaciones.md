---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [flujo, recomendaciones, lastfm, cache, home]
---

# Recomendaciones para Home

> El Home arma 4+ filas: `similar-artist`, `mix-by-track`, `genre-mix`, `discover`. Cada una pasa por Last.fm + Innertube + cache server 12h.

## Diagrama

```mermaid
sequenceDiagram
  participant Home as Home component
  participant Rec as recommendations store
  participant Edge as Edge /recommendations
  participant Cache as recommendation_cache
  participant LFM as Last.fm
  participant YT as Innertube
  participant Hist as play_history

  Home->>Rec: fetch('similar-artist', seedArtist)
  Rec->>Rec: cache key = 'similar-artist:Arctic Monkeys'
  alt hit en memoria de sesión
    Rec-->>Home: tracks (sin red)
  else miss
    Rec->>Edge: GET /recommendations?kind=similar-artist&seed=...
    Edge->>Cache: SELECT WHERE user_id, kind, seed, age < 12h
    alt cache hit server
      Cache-->>Edge: payload
      Edge-->>Rec: payload (cached: true)
    else cache miss
      Edge->>Hist: SELECT top tracks usuario (para 'discover')
      Edge->>LFM: artist.getSimilar(seed)
      LFM-->>Edge: similar artists
      loop por cada similar artist
        Edge->>LFM: artist.getTopTracks
        LFM-->>Edge: top tracks
      end
      loop por cada track candidato
        Edge->>YT: search "<artist> <title>"
        YT-->>Edge: primer hit → ytId
      end
      Edge->>Cache: UPSERT payload
      Edge-->>Rec: payload (cached: false)
    end
    Rec->>Rec: tracks.map(recToTrack) — id "yt:<ytId>"
    Rec-->>Home: tracks efímeros
  end

  Home-->>Home: render TrackCard rows
```

## Decisiones documentadas

- **Cache server 12h** — Last.fm y YouTube similar artists no cambian con frecuencia.
- **Tracks efímeros** — `id = "yt:<ytId>"`, no se persisten en `tracks` hasta que el usuario los guarde explícitamente.
- **`reason` propagado** — campo extra para mostrar "Similar a Arctic Monkeys" como subtítulo de la fila.
- **`discover` filtra biblioteca del usuario** — evita recomendar tracks que ya tiene.
- **Cron de limpieza** ([[migrations#20260515]]) — borra entries con TTL excedido cada hora.

## Módulos involucrados

- UI: [[Home]] + sub-componentes (`HomeRow`, `TrackCard`).
- Estado: [[recommendations]] store, [[history]] store (para `discover`), [[library]] store.
- Edge: [[recommendations]] function.
- DB: [[recommendation_cache]].
- APIs externas: Last.fm (`ws.audioscrobbler.com`), Innertube (`youtube.com/youtubei/v1/search`).

## Notas / Changelog
- 2026-05-22: F8.
