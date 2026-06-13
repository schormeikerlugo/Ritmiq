---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-06-13
archivo: packages/ui/src/components/SaveDialog/SaveDialog.jsx
tags: [componente, guardar, playlist, modal, portal]
---

# `SaveDialog`

> Modal para guardar un track en una o varias playlists. Muestra playlists existentes con toggles + creación de playlist nueva. Adapta su render según plataforma (portal / [[BottomSheet]]).

## Ubicación
`packages/ui/src/components/SaveDialog/SaveDialog.jsx:1` (470 líneas)

## Props

```js
{
  track?: Track,        // modo single (back-compat)
  tracks?: Track[],     // modo multi (selección múltiple); si llega, gana sobre `track`
  onClose: () => void
}
```

`multi = Array.isArray(tracks) && tracks.length > 0`. En modo multi opera sobre todos los items; el título pasa a `Guardar N canciones`.

## Stores consumidos

| Store | Uso |
|---|---|
| [[library]] store | `persistEphemeral` (si el track es efímero), `tracks` |
| [[playlists]] store | `playlists`, `contents`, `addTrack`, `removeTrack`, `create`, **`addTracks`, `removeTracks`** (modo multi) |
| [[bottom-sheet]] store | `open` (modo mobile) |

## Modo multi-track (selección múltiple)

El checkbox de cada playlist es **tri-estado** según cuántos de los tracks seleccionados ya están en ella:
- `all` → `Check` (lleno). Toggle → quita todos (`removeTracks`).
- `some` → `Minus` (parcial). Toggle → añade los que faltan (`addTracks`).
- `none` → vacío. Toggle → añade todos (`addTracks`).

Antes de cualquier acción, persiste los efímeros de la selección (`ensurePersistedAll`). Un solo toast agregado por operación (lo emiten las acciones plurales del store). Ver [[Decisiones-Tecnicas-ADR|ADR-030]].

## Render adaptativo

```js
// Desktop: createPortal + useLockBodyScroll
// Mobile (useMobileViewport): BottomSheet via open({ content: <Body /> })
```

El cuerpo (`SaveDialogBody`) es un componente separado con su propio estado local (`creating`, `newName`) para que el [[BottomSheet]] no se recree en cada teclazo del input.

## Flujo

1. Si el track es efímero → `persistEphemeral` antes de cualquier acción.
2. Lista de playlists con checkbox → `addTrack`/`removeTrack` en [[playlists]].
3. Input "Nueva playlist" → `create(name)` + `addTrack`.

## Invocado desde

- [[Player]] → botón "+"
- [[NowPlaying]] → opción "Guardar en playlist"
- [[PlaylistView]] → menú contextual de track (single) **y barra de selección (multi)**
- [[Library]] → barra de selección del filtro Descargados (multi)

## Notas / Changelog
- 2026-05-22: nivel medio.
- 2026-06-13 (multi-track): soporta `tracks[]` además de `track` (back-compat). Checkbox
  tri-estado por playlist + acciones plurales `addTracks`/`removeTracks`. Usado por la
  selección múltiple de [[PlaylistView]] y [[Library]]. Ver [[Decisiones-Tecnicas-ADR|ADR-030]].
