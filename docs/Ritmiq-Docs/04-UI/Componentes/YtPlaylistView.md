---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/YtPlaylistView/YtPlaylistView.jsx
tags: [componente, youtube, playlist, search]
---

# `<YtPlaylistView>`

> Vista dedicada para una playlist pública de YouTube resuelta desde [[SearchView]]. Header con cover gradient + actions (Reproducir / Guardar) + tracks reproducibles. Parallelo a [[ArtistView]] y [[AlbumView]] en estilo.

## Ubicación
`packages/ui/src/components/YtPlaylistView/YtPlaylistView.jsx:1` (~240 líneas)

## Props

```js
<YtPlaylistView id="PLxxxxxxxxxxxxxxxxx" />
```

| Prop | Tipo | Notas |
|---|---|---|
| `id` | `string` | YouTube `playlistId`. Puede venir con o sin prefijo `VL`. |

## Stores y hooks consumidos

| Fuente | Uso |
|---|---|
| [[yt-playlist|yt-playlist store]] | `fetch(id)`, `entries[id]` |
| [[player]] store | `playNow(tracks, idx)` |
| [[playlists]] store | `create`, `addTrack`, `setCover` (al guardar) |
| [[library]] store | `load` (refrescar tras guardar) |
| [[auth]] store | `user?.id` |
| [[api]] | `libraryAddFromMeta` |
| [[sync]] / [[sync-queue]] | `pushTrack` + `tryOrQueue` (desktop) |

## Estados visuales

1. **Loading**: `<HeroSkeleton>` + `<TrackRowSkeleton count={6}>`.
2. **Error**: `<ErrorState>` con `onRetry`.
3. **Loaded**: header + actions + tracks.

## Acciones

### Reproducir todos

`playNow(tracks, 0)`. Carga la playlist completa como cola.

### Guardar en biblioteca

Confirm dialog → crea playlist en biblioteca → itera tracks llamando `libraryAddFromMeta` + `pushTrack` (desktop) + `addTrack` en serie. Toast con progreso. Cover de la playlist se setea con `entry.coverUrl`.

Reusa el mismo pipeline que [[artist|saveAlbumAsPlaylist]] del store de artist.

## Click en track

```js
playNow(tracks, i)
```

Carga la lista completa como cola, posicionado en el track clickeado.

## Cómo se llega

Desde [[SearchView]] (tab Playlists o tab Todo) → click en card de playlist → `goYtPlaylist(p.id)` de [[view]] store → MainView routea a este componente.

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Cambiar el shape del entry del [[yt-playlist|store]] | Rompe la renderización; afecta este componente y `YtPlaylistView` |
| Quitar `pushTrack` en desktop | FK violation 23503 en `playlist_tracks.track_id` |
| Cambiar el confirm dialog por dispatch directo | UX rota: el usuario podría disparar guardado sin querer |

## Casos de borde

- **Playlist con 100+ tracks**: el guardado serial puede tardar 1-3 min. Toast con contador muestra progreso. User puede navegar mientras tanto.
- **Track sin `ytId` válido** (descartado por la edge function pero defensivo): `libraryAddFromMeta` lo descarta, `failed++`.
- **Sin sesión activa**: toast.error "Inicia sesión para guardar playlists".
- **Cover null en la playlist**: usa el thumbnail del primer track como fallback (lo decide la edge function).

## Sub-componentes

- [[CoverArt]] en placeholders y track rows.
- [[ConfirmDialog]] del módulo primitives.
- [[HeroSkeleton]] / [[TrackRowSkeleton]] de [[Skeleton]].
- [[ErrorState]] de primitives.

## Changelog

- 2026-05-27 — Creado en Fase 0.5. Commit `d585e68`.
