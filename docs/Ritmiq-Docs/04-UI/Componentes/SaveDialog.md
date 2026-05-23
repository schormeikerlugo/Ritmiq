---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
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
  track: Track,
  onClose: () => void
}
```

## Stores consumidos

| Store | Uso |
|---|---|
| [[library]] store | `persistEphemeral` (si el track es efímero) |
| [[playlists]] store | `playlists`, `contents`, `addTrack`, `removeTrack`, `create` |
| [[bottom-sheet]] store | `open` (modo mobile) |

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
- [[PlaylistView]] → menú contextual de track

## Notas / Changelog
- 2026-05-22: nivel medio.
