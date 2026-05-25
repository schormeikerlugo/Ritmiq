---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-24
archivo: packages/ui/src/components/EditTrackDialog/EditTrackDialog.jsx
tags: [componente, editar, track, modal, p2p, knowledge-base]
---

# `EditTrackDialog`

> Modal para que el usuario corrija manualmente el `title` y `artist` de un track ya guardado en su biblioteca. Permite limpiar nombres sucios de YouTube ("Waiting For The End (Official Music Video) [4K Upgrade]" → "Waiting For The End") sin esperar a que la utility automática [[clean-track-meta]] lo pille.

## Ubicación

`packages/ui/src/components/EditTrackDialog/EditTrackDialog.jsx`
`packages/ui/src/components/EditTrackDialog/EditTrackDialog.module.css`

## Props

```ts
{
  track: Track;            // Track con valores actuales (debe estar en biblioteca)
  onClose: () => void;
  onSaved?: (updated: Track) => void;  // callback opcional tras save exitoso
}
```

## Comportamiento del Save

Cuando el user presiona "Guardar", se invoca [[library|library.updateMeta]]`(track.id, { title, artist })` que dispara en cadena:

1. **Optimistic update**: el store `useLibraryStore.tracks` se actualiza inmediato.
2. **Player sync**: si el track editado coincide con `currentTrack`, se reemplaza en el store del player → la barra del Player y NowPlaying se refrescan en vivo. El `MediaSession.metadata` también se refresca automáticamente vía el `useEffect[currentTrack]` de `use-player.js` (lockscreen / AirPods).
3. **Queue sync**: cualquier ocurrencia del track en `queue` también se reemplaza.
4. **Persiste a Supabase** vía `pushTrack` con `tryOrQueue` (resiliente offline).
5. **Desktop**: replica a SQLite local vía nuevo IPC `library:update` → `apps/desktop/main/ipc.js`.
6. **Realtime**: el UPDATE en Supabase llega a los otros devices del mismo user vía `applyRemote` (sin código nuevo).
7. **Fire-and-forget**: invoca [[publish-meta-edit|publishMyMetaEdit]] que llama a [[publish-track-meta]] con los valores limpios. Si era el primer humano publicando ese `ytId`, su edición se vuelve canónica para futuros usuarios en [[tracks_global]] (first-write-wins). Si ya estaba canonizado, solo incrementa `contribution_count`.

## Validación

- `title` requerido (trim, no vacío). Botón Guardar disabled si vacío.
- `title`, `artist`, `album` max 500 chars (validado client + server en publish-track-meta).
- Pristine detection: si nada cambió respecto a los 3 campos originales, botón disabled.
- `artist` y `album` opcionales → `null` en BD si vacío. UI fallback "Artista desconocido"/"—".
- **NO se aplica** [[clean-track-meta|cleanYoutubeTitle]] al input del user. La edición manual es autoritativa — limpiar automáticamente sería paternalista.

## Entry points

| Lugar | Cómo |
|---|---|
| [[PlaylistView]] dropdown menu de cada fila | Item "Editar título y artista" con icono `Pencil`. |
| [[NowPlaying]] menú `⋯` | Item "Editar título y artista" con icono `Pencil`. Si el track es efímero, se persiste primero vía `persistEphemeral`. |
| [[TrackInfoDialog]] | Botón "Editar" debajo del título. Cierra TrackInfoDialog y abre EditTrackDialog (controlado por el parent). |

## Privacidad

- La edición es **per-user**. Otros usuarios con el mismo `ytId` en su biblioteca **NO ven cambios**.
- El UPDATE en [[tracks]] respeta RLS `owner-only`.
- La contribución a [[tracks_global]] es anónima (sin `user_id`, sin IP, sin device).
- Si era el primer humano publicando ese yt_id → su edición se canoniza para la red. Si no → solo incrementa `contribution_count`.

## Edge cases manejados

- **Track sonando ahora**: Player bar + NowPlaying + MediaSession se actualizan en vivo.
- **Track en N playlists**: una sola fila en `tracks` se actualiza → todas las playlists reflejan el cambio automáticamente (renderean por id lookup).
- **Track efímero**: persistir primero (path NowPlaying). PlaylistView/TrackInfoDialog ya operan sobre tracks persistidos por definición.
- **Offline**: `tryOrQueue` encola el UPDATE; se aplica al recuperar red.
- **Race con Realtime de otro device**: last-write-wins por `updated_at` trigger.

## Casos NO contemplados (futuro)

- Edición de `coverUrl` (requiere Storage upload, scope separado).
- Edición batch multi-track.
- Restaurar al título original (requiere columna `original_title`).
- Sistema de votos federado para [[tracks_global]] (modelo MusicBrainz, F2).

## Changelog

- 2026-05-24: añadido campo `album` opcional (3er input). Antes diferido, ahora incluido. Backend ya lo soportaba sin cambios — solo +10 LOC en el JSX.

## Cross-references

- [[library|library.updateMeta]] — store action que orquesta todo
- [[publish-meta-edit|publishMyMetaEdit]] — helper P2P del fire-and-forget
- [[publish-track-meta]] — Edge function que recibe el publish
- [[tracks_global]] — tabla destino del knowledge sharing
- [[clean-track-meta]] — utility canónica (NO aplica a inputs manuales)
- [[Modal]] — wrapper genérico con backdrop + ESC + portal
- [[p2p-knowledge-sharing]] — flujo completo P2P
