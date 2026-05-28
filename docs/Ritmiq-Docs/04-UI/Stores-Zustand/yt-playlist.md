---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/stores/yt-playlist.js
tags: [store, youtube, playlist, innertube, edge-function]
---

# `stores/yt-playlist.js`

> Store de playlists públicas de YouTube. Resuelve metadata + tracks vía la Edge Function [[yt-playlist-resolve]]. Cache en memoria por sesión (sin persistencia ni cache server-side por ahora).

## Ubicación
`packages/ui/src/stores/yt-playlist.js:1` (62 líneas)

## Estado

```js
{
  entries: Record<string, {
    loading?: boolean,
    error?: string | null,
    id?: string,                // YouTube playlistId
    title?: string,
    author?: string | null,
    coverUrl?: string | null,
    tracks?: Array<{
      ytId: string,
      title: string,
      artist: string | null,
      thumbnail: string | null,
      duration: number | null,
    }>,
  }>
}
```

Clave: el `playlistId` de YouTube (string opaco, no UUID).

## Acciones

### `fetch(id)`

- Idempotente: si ya hay `entry.tracks.length > 0` o `entry.loading`, devuelve la existente.
- Envuelve `callEdge` con [[with-retry]] (3 intentos por defecto).
- Server response → upserts en `entries[id]`.

### `reset()`

Limpia el mapa.

## Cuándo se usa

- [[SearchView]] muestra resultados de tipo playlist. Click → [[view|view store]] `goYtPlaylist(id)`.
- [[YtPlaylistView]] llama `useYtPlaylistStore.fetch(id)` al montar.

## Por qué sin cache server-side

La Edge Function [[yt-playlist-resolve]] **no cachea** en una tabla `yt_playlist_cache`. Razón: las playlists YT del search son **menos frecuentes** que albums (que sí tienen `album_resolve_cache` con TTL 7d).

Si en el futuro este endpoint se convierte en hot path, crear la tabla con la misma estructura que `album_resolve_cache`:

```sql
create table yt_playlist_cache (
  yt_playlist_id text primary key,
  payload        jsonb not null,
  refreshed_at   timestamptz not null default now()
);
```

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Mover a cache server-side | Requiere migración SQL + actualizar la edge function |
| Cambiar la clave de `entries` (id → URL completa) | Invalida el cache cliente en runtime |
| Quitar withRetry | Errores 5xx de Innertube visibles para el user |

## Casos de borde

- **PlaylistId sin tracks reproducibles** (playlist privada o de podcasts): el servidor responde 404 → `entry.error` con mensaje. [[YtPlaylistView]] muestra `ErrorState`.
- **`id` con prefijo `VL` o sin él**: el endpoint normaliza ambos (`VL${id}` interno).
- **Tracks sin `ytId`** (raro pero posible): el store los descarta vía filter en el caller [[YtPlaylistView]].

## Changelog

- 2026-05-27 — Creado en Fase 0.5. Commit `d585e68`.
