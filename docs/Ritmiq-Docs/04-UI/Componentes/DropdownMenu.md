---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/DropdownMenu/DropdownMenu.jsx
tags: [componente, dropdown, menu-contextual, accesibilidad]
---

# `DropdownMenu`

> Menú desplegable contextual reutilizable. Se adapta como dropdown en desktop y abre un [[BottomSheet]] en mobile.

## Ubicación
`packages/ui/src/components/DropdownMenu/DropdownMenu.jsx:1` (302 líneas)

## Props

```js
{
  trigger: ReactNode,      // elemento que abre el menú
  items: Array<{
    label: string,
    icon?: string,         // nombre de Icon
    onClick: () => void,
    danger?: boolean,      // rojo en desktop
    disabled?: boolean,
  }>,
  align?: 'left' | 'right'  // alineación del dropdown, default 'right'
}
```

## Render adaptativo

| Plataforma | Render |
|---|---|
| Desktop (`!useMobileViewport()`) | `<div>` desplegable con `position: absolute`, cierre al click fuera |
| Mobile | `useBottomSheet().open({ content: <ItemList /> })` |

## Cierre automático

- Desktop: listener `mousedown` en el document con `contains(e.target)` check.
- Mobile: el [[BottomSheet]] gestiona su propio cierre (swipe down, backdrop click).

## Usado por

[[PlaylistView]], [[Library]], [[NowPlaying]], [[TrackInfoDialog]], múltiples menús contextuales de track.

## Notas / Changelog
- 2026-05-22: nivel medio.
