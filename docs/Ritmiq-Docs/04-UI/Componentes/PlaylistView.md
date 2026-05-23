---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/PlaylistView/PlaylistView.jsx
tags: [componente, playlist, dnd-kit, drag-drop, color-dominante]
---

# `PlaylistView`

> Vista de playlist individual. Hero con cover + gradiente del color dominante, lista ordenable con drag-and-drop (@dnd-kit), acciones por track (guardar, compartir, borrar, info), exportación JSON/CSV y modo Smart Download.

## Ubicación
`packages/ui/src/components/PlaylistView/PlaylistView.jsx:1` (1196 líneas, es el más grande de los medios)

## Props
Sin props. Lee `view.playlistId` del store.

## Stores y helpers consumidos

| Fuente | Uso |
|---|---|
| [[library]] store | `tracks`, `download` |
| [[playlists]] store | `playlists`, `contents`, `reorder`, `removeTrack`, `setOffline`, `setCover` |
| [[player]] store | `playNow`, `currentTrack`, `isPlaying`, `playNext`, `enqueue` |
| [[view]] store | `goBack`, `goArtist`, `view` |
| [[downloads]] store | `enqueue` |
| [[social]] store | `friends` |
| [[dominant-color]] | Color de fondo del hero |
| [[export]] | `exportPlaylistJson`, `exportPlaylistCsv` |
| [[lan-client]] | `prewarmStream` |

## Drag & Drop (@dnd-kit)

```jsx
<DndContext sensors={sensors} onDragEnd={handleDragEnd}>
  <SortableContext items={...} strategy={verticalListSortingStrategy}>
    {tracks.map(t => <SortableRow key={t.id} track={t} />)}
  </SortableContext>
</DndContext>
```

**Sensores**: `MouseSensor(distance: 4)` para desktop, `TouchSensor(delay: 220, tolerance: 6)` para mobile (distingue tap de drag). Sin delay adecuado, cualquier scroll inicia un drag.

**`handleDragEnd`**: llama `playlists.reorder(playlistId, newOrder)` → optimistic update + Supabase.

## Sub-componentes usados
- [[DropdownMenu]] (menú contextual por track)
- [[RenameDialog]], [[SaveDialog]], [[TrackInfoDialog]], [[CoverUploadDialog]]
- [[ShareToFriendModal]]
- [[DownloadIndicator]]
- [[Icon]], [[Skeleton]]

## Comportamiento clave

### Smart Download toggle
`setOffline(id, !isOffline)` — activa descarga automática de nuevos tracks al añadirlos. Ver [[playlists#setOffline]].

### Prewarm on hover
`onMouseEnter` del track → `prewarmStream(ytId)` con prioridad 5.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Sin `delay: 220` en TouchSensor | Scroll vertical inicia arrastre → lista de playlist no se puede scrollear en mobile. |
| `reorder` sin optimistic update | El usuario ve el rebote visual al reordenar por drag (150-500ms de latencia). |

## Notas / Changelog
- 2026-05-22: nivel pleno.
