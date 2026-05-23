---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/sync.js
tags: [helper, sync, supabase, pull, push]
---

# `lib/sync.js`

> Capa de sync entre Supabase y la biblioteca local. Pull (cargar al iniciar) + Push (cada mutación). Mappers camelCase ↔ snake_case con `rewriteHost` aplicado en pull.

## Ubicación
`packages/ui/src/lib/sync.js:1` (184 líneas)

## Exports

| Función | Dirección | Descripción |
|---|---|---|
| `pullTracks()` | Supabase → cliente | SELECT * tracks ORDER BY created_at DESC |
| `pushTrack(track)` | cliente → Supabase | UPSERT on conflict id |
| `deleteTrackRemote(trackId)` | cliente → Supabase | DELETE WHERE id |
| `pullPlaylists()` | Supabase → cliente | SELECT * playlists ORDER BY created_at ASC |
| `pushPlaylist(p)` | cliente → Supabase | UPSERT on conflict id |
| `deletePlaylistRemote(playlistId)` | cliente → Supabase | DELETE |
| `pullPlaylistContents()` | Supabase → cliente | `{ playlistId: [trackId] }` ordenado por position |
| `pushPlaylistTrack(playlistId, trackId, position)` | cliente → Supabase | UPSERT on conflict `playlist_id,track_id` |
| `removePlaylistTrackRemote(playlistId, trackId)` | cliente → Supabase | DELETE |
| `reorderPlaylistRemote(playlistId, orderedIds)` | cliente → Supabase | UPSERT bulk positions |

## Decisión de diseño: `is_downloaded: false` en push

```js
function trackToRow(t) {
  return {
    // ...
    is_downloaded: false,  // file_path/is_downloaded son por-dispositivo
  };
}
```

**Por qué**: `is_downloaded` y `file_path` son per-device. Supabase no debe saber si un dispositivo concreto tiene el archivo — eso vive en SQLite (Desktop) o IndexedDB (PWA). Al pushear al cloud, siempre se envía `false` para no contaminar otros dispositivos.

## `rewriteHost` en pull

```js
function rowToTrack(r) {
  return {
    coverUrl: rewriteHost(r.cover_url),
    // ...
  };
}
```

Aplica [[url-rewrite]] para que las portadas guardadas con IP loopback funcionen en la PWA del móvil en dev LAN.

## Invocado por

- [[library]] store → `pullTracks`, `pushTrack`, `deleteTrackRemote`.
- [[playlists]] store → todas las funciones de playlists.
- [[sync-queue]] → usa estas funciones como implementación de `applyOp`.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| `is_downloaded: t.isDownloaded` en push | El estado de descarga de un dispositivo se propaga a todos los demás → iOS muestra tracks como "descargados" aunque no los tenga. |
| Sin `onConflict` en upsert | Inserta duplicados si el track ya existe → error de PK violation. |

## Notas / Changelog
- 2026-05-22: nivel medio.
