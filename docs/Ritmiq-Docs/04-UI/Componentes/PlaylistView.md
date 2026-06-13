---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-06-13
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
| [[library]] store | `tracks`, `download`, `undownload`, `undownloadMany` |
| [[playlists]] store | `playlists`, `contents`, `reorder`, `removeTrack`, `removeTracks`, `toggleFavoriteMany`, `setOffline`, `setCover` |
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

### Selección múltiple
Botón "Seleccionar" (`ListChecks`) en el header. Estado local: `selectMode` + `selected` (Set de trackIds). En `selectMode`:
- Se **omiten `DndContext`/`SortableContext`** (render plano) — el drag&drop entra en conflicto con la gesticulación de selección; se reusa el mismo render que el filtrado.
- **Toda la fila `<li>` es el área de toque** (`onClick` en el `<li>`, no en un botón interno): los hijos llevan `pointer-events: none` para que el tap burbujee y togglee. Mejor UX móvil y sin zonas muertas entre thumb y menú.
- `PlaylistRow` **no** usa `React.memo` (era inútil: `actions` se recrea cada render).
- El indicador de descarga se pinta en **verde** (`CheckCircle2` filled, `var(--color-success)`) para que se distinga de gris.

Barra de acciones sticky con: seleccionar todo, Reproducir, Cola, Favoritos (`toggleFavoriteMany`), Añadir a playlist ([[SaveDialog]] multi vía `tracks[]`), Descargar/Quitar descarga (`enqueue(array)` / `undownloadMany`), Quitar de la playlist (`removeTracks` + ConfirmDialog). Ver [[Decisiones-Tecnicas-ADR|ADR-030]].

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Sin `delay: 220` en TouchSensor | Scroll vertical inicia arrastre → lista de playlist no se puede scrollear en mobile. |
| `reorder` sin optimistic update | El usuario ve el rebote visual al reordenar por drag (150-500ms de latencia). |

## Notas / Changelog
- 2026-06-13 (selección múltiple): modo de selección de N canciones con barra de acciones
  de lote; toda la fila como área de toque en `selectMode` (sin DnD); indicador de descarga
  en verde; sin `React.memo`. El hero desktop dejó de usar `margin-top` negativo (ya no hay
  `padding-top` en el `.main`). Ver [[Decisiones-Tecnicas-ADR|ADR-030]].
- 2026-05-22: nivel pleno.
- 2026-05-31 (fix anim): el FAB de play en estado `data-playing` usaba `fabGlow` animando
  `box-shadow` → tirones en Electron desktop. Migrado a un `::after` con el ring/glow
  estático que anima solo `opacity` + `scale` (GPU). Las `fabPulseBars` (eq) ya usaban
  `scaleY` y no se tocaron. De paso, corregido bug de sintaxis `var(--color-accent-hover))`
  (doble paréntesis) en `.playFab[data-active]`. Ver [[Decisiones-Tecnicas-ADR|ADR-020]].
