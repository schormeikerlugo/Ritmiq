---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/Modal/Modal.jsx
tags: [componente, modal, overlay, portal, accesibilidad]
---

# `Modal`

> Wrapper de modal genérico con backdrop y cierre por ESC/click fuera. Renderizado via `createPortal` en `document.body`. Bloquea scroll del body con [[use-lock-body-scroll]].

## Ubicación
`packages/ui/src/components/Modal/Modal.jsx:1` (211 líneas)

## Props

```js
{
  open: boolean,
  onClose: () => void,
  title?: string,
  children: ReactNode,
  size?: 'sm' | 'md' | 'lg',  // default 'md'
  hideClose?: boolean,
}
```

## Comportamiento

- Cierre en ESC via `useEffect` + `keydown` listener.
- Cierre en click del backdrop (`e.target === backdropRef.current`).
- `useLockBodyScroll(open)` — bloquea scroll mientras abierto.
- Animación `fade-in` del backdrop + `slide-down` del contenido.
- Focus trap: al abrir hace `focus()` en el primer elemento focuseable del contenido.

## Invocado desde

[[TrackInfoDialog]], [[ShareToFriendModal]], [[EditProfileDialog]] (desktop).

## Notas / Changelog
- 2026-05-22: nivel simple.
