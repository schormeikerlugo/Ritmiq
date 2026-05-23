---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-lock-body-scroll.js
tags: [hook, scroll, modal, ui, css]
---

# `useLockBodyScroll(active?)`

> Bloquea el scroll del `<body>` mientras un modal/sheet está abierto. Usa un contador global para ser stackeable: si dos modales abren simultáneamente, el body sigue bloqueado hasta que ambos cierren.

## Ubicación
`packages/ui/src/lib/use-lock-body-scroll.js:1` (91 líneas)

## Firma

```js
function useLockBodyScroll(active?: boolean = true): void
```

## Mecanismo

Inyecta un `<style id="__ritmiq_scroll_lock_style">` en `<head>` al primer uso (idempotente) y agrega/quita la clase `ritmiq-scroll-locked` en `<html>` y `<body>`.

```css
html.ritmiq-scroll-locked,
body.ritmiq-scroll-locked {
  overflow: hidden !important;
  touch-action: none !important;
}
body.ritmiq-scroll-locked main,
body.ritmiq-scroll-locked [class*="main_"],
body.ritmiq-scroll-locked [class*="scrollContainer_"] {
  overflow: hidden !important;
}
```

## Contador global (stackeable)

```js
let lockCount = 0;
// Al montar (con active=true):
if (lockCount === 0) applyLock();
lockCount++;
// Al desmontar:
lockCount--;
if (lockCount === 0) applyUnlock();
```

**Por qué el contador**: si NowPlaying y un BottomSheet están abiertos simultáneamente, ambos llaman `useLockBodyScroll`. Sin contador, el primero en cerrar haría `applyUnlock()` y el segundo modal perdería el bloqueo.

## Compensación de scrollbar

```js
const sbw = window.innerWidth - document.documentElement.clientWidth;
if (sbw > 0) {
  document.body.style.paddingRight = `${sbw}px`;
}
```

**Por qué**: al aplicar `overflow: hidden`, el scrollbar desaparece y el contenido "salta" hacia la derecha `sbw` píxeles. El padding derecho compensa ese salto.

## Por qué CSS class y no inline styles

Inline styles son difíciles de revertir atómicamente (hay que recordar el valor anterior). La clase CSS se aplica/quita con `classList`, que es idempotente y no pierde el valor de `overflow` del autor.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Contador por booleano (no numérico) | El segundo modal que cierra hace unlock aunque el primero siga abierto. |
| Quitar padding-right compensation | Contenido "salta" lateralmente al abrir/cerrar modales en desktop con scrollbar visible. |

## Notas / Changelog
- 2026-05-22: nivel medio.
