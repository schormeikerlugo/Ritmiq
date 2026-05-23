---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/RenameDialog/RenameDialog.jsx
tags: [componente, renombrar, playlist, dialog]
---

# `RenameDialog`

> Dialog inline para renombrar una playlist. Input auto-seleccionado al abrir, Enter confirma, Escape cancela.

## Ubicación
`packages/ui/src/components/RenameDialog/RenameDialog.jsx:1` (143 líneas)

## Props

```js
{
  playlistId: string,
  currentName: string,
  onClose: () => void
}
```

## Stores consumidos

| Store | Uso |
|---|---|
| [[playlists]] store | `rename(id, newName)` |

## Comportamiento

- Input pre-cargado con `currentName` y `select()` al montar.
- Validación: nombre no vacío y diferente al actual.
- Submit → `playlists.rename(playlistId, newName)` → `onClose()`.
- Rendereado como [[BottomSheet]] en mobile, modal inline en desktop.

## Notas / Changelog
- 2026-05-22: nivel simple.
