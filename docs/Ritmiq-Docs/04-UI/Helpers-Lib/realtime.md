---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/realtime.js
tags: [helper, realtime, supabase, canales]
---

# `lib/realtime.js`

> Cliente Realtime de dominio para `tracks`, `playlists` y `playlist_tracks`. Singleton `realtime` con métodos `start(userId, handlers)` y `stop()`.

## Ubicación
`packages/ui/src/lib/realtime.js:1` (76 líneas)

## Exports

```js
class RealtimeManager {
  start(userId: string, handlers: {
    onTracks(e: RealtimeEvent): void,
    onPlaylists(e: RealtimeEvent): void,
    onPlaylistTracks(e: RealtimeEvent): void,
  }): void
  stop(): void
}
export const realtime: RealtimeManager
```

## Tres canales Supabase

| Canal | Tabla | Filtro | Descripción |
|---|---|---|---|
| `rt-tracks-{userId}` | `tracks` | `user_id=eq.{userId}` | Cambios en la biblioteca |
| `rt-playlists-{userId}` | `playlists` | `user_id=eq.{userId}` | Cambios en playlists |
| `rt-playlist-tracks-{userId}` | `playlist_tracks` | Sin filtro (RLS) | Cambios en tracks de playlists |

## Por qué `playlist_tracks` sin filtro

`playlist_tracks` no tiene columna `user_id` directa. Suscribimos sin filtro y RLS de Supabase se encarga de filtrar: solo llegan filas de las playlists del usuario autenticado.

## Idempotencia del `start`

```js
start(userId, handlers) {
  if (this.userId === userId) return;  // misma sesión → no re-suscribir
  this.stop();  // desconectar sesión anterior
  // ...
}
```

## Invocado por

- [[App]] → `realtime.start(userId, handlers)` al iniciar sesión, donde `handlers` llama a `applyRemote` de [[library]] y [[playlists]] stores.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| No llamar `stop()` antes de `start()` con nuevo userId | Canales del usuario anterior siguen activos → datos mezclados. |
| Filtro en `playlist_tracks` por `playlist_id` | No recibirías cambios de todas las playlists del usuario. |

## Notas / Changelog
- 2026-05-22: nivel medio.
