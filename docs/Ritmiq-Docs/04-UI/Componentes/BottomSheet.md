---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/BottomSheet/BottomSheetHost.jsx
tags: [componente, bottom-sheet, overlay, stack, mobile]
---

# `BottomSheetHost` + `BottomSheet`

> Punto único de render para todos los bottom sheets. `BottomSheetHost` se monta UNA VEZ en App.jsx y renderiza el stack del [[bottom-sheet]] store. Cada sheet es una instancia de `BottomSheet`.

## Ubicación
`packages/ui/src/components/BottomSheet/BottomSheetHost.jsx:1`
`packages/ui/src/components/BottomSheet/BottomSheet.jsx:1`
(367 líneas totales)

## `BottomSheetHost`

```jsx
// App.jsx
<div className={styles.shell}>
  ...
  <BottomSheetHost />
</div>
```

Lee `stack[]` del [[bottom-sheet]] store y renderiza un `<BottomSheet>` por cada entrada, uno encima del otro.

## `BottomSheet`

```jsx
<BottomSheet
  entry={entry}        // BottomSheetEntry del store
  onClose={callback}   // llamado SOLO si el sheet pide cerrarse por interacción
/>
```

Gestiona:
- Animación de entrada (slide-up desde abajo) y salida (slide-down).
- Backdrop semitransparente con click para cerrar si `dismissOnBackdrop !== false`.
- Swipe-down en el handle para cerrar.
- ESC key para cerrar.
- `useLockBodyScroll(true)` mientras está abierto.

## Contrato de `onClose`

Los métodos `close()`, `closeById()`, `closeAll()` del store **NO llaman** a `entry.onClose`. Solo el `BottomSheetHost` lo llama cuando el sheet se cierra por interacción del usuario (swipe, backdrop, ESC). Esto evita dobles callbacks cuando se cierra externamente (navegación, cleanup de useEffect). Ver [[bottom-sheet#anatomía]].

## Limitación iOS PWA standalone

En modo standalone iOS puede quedar un pequeño espacio entre el panel y el borde físico inferior. Es una limitación conocida de `position:fixed` en iOS WebKit standalone. No es un bug del código.

## Notas / Changelog
- 2026-05-22: nivel medio.
- 2026-05-27 (Fase 2.6): drag-to-dismiss refactor:
  - Migración de touch events (`touchstart/move/end`) a **Pointer Events** unificados → mouse drag funciona en desktop ahora.
  - `setPointerCapture` evita perder el drag cuando el cursor sale del sheet.
  - Threshold de cierre cambia de px fijo (80) a **% del alto** del sheet (35%) → natural en cualquier viewport.
  - Backdrop dim **dinámico** durante el drag (opacity 1 → 0.4).
  - Handle visual cambia (opacity 0.85 + width 44px) durante drag.
  - Header también captura el drag (más área).
  - Commit `13fccfa`.
