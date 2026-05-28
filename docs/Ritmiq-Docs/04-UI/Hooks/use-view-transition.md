---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/lib/use-view-transition.js
tags: [hook, gsap, motion, transition, reduced-motion]
---

# `useViewTransition(ref, opts)`

> Hook reusable que envuelve GSAP para transiciones de entrada de componentes y vistas. Respeta `prefers-reduced-motion` y limpia los tweens al unmount.

## Ubicación
`packages/ui/src/lib/use-view-transition.js:1` (129 líneas)

## Por qué existe

Ver [[Decisiones-Tecnicas-ADR|ADR-008]]. Antes cada vista usaba su propia animación CSS de entrada con timings inconsistentes y sin un único lugar donde gestionar reduced-motion. Este hook centraliza presets y maneja el cleanup correctamente para evitar leaks en remounts agresivos.

## Firma

```js
useViewTransition(ref, {
  preset = 'fadeUp',        // 'fadeUp' | 'fadeIn' | 'fadeUpLg' | 'stagger'
  deps = [],
  duration = 0.32,          // segundos
  delay = 0,
  childSelector = ':scope > *',  // solo para preset='stagger'
  staggerEach = 0.04,
  disabled = false,
});
```

## Presets

| Preset | Animación |
|---|---|
| `'fadeUp'` (default) | `opacity 0 + y +12px → 1 + 0`. Power2.out, 320ms. Para entradas estándar. |
| `'fadeIn'` | Solo opacity. Más sutil; para overlays. |
| `'fadeUpLg'` | Como fadeUp pero `y +24px`. Para heroes grandes. |
| `'stagger'` | Anima los hijos directos del ref con `staggerEach` de offset. Ideal para listas y carruseles. |

## Reduced motion

Usa `gsap.matchMedia()` con condición `(prefers-reduced-motion: reduce)`. Cuando está activo:

- Se hace `gsap.set(node, { clearProps: 'all' })` para garantizar el estado final sin tween.
- En modo `stagger`, también se limpian los hijos.

No requiere CSS adicional — el mismo hook respeta la preferencia del SO.

## clearProps al terminar

Todas las animaciones llaman `clearProps: 'transform,opacity'` al terminar:

```js
gsap.fromTo(node,
  { opacity: 0, y: 12 },
  { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out',
    clearProps: 'transform,opacity' });
```

Sin esto, los `style` inline residuales rompen `hover` y `focus-visible` posteriores.

## Cleanup en unmount

```js
return () => mm.revert();
```

`mm.revert()` mata todos los tweens creados dentro del `matchMedia` Y restaura los inline styles. Hace lo mismo que `gsap.context()` pero limitado a las animaciones de este hook (no toca tweens externos del mismo elemento).

## Dónde se usa

| Caller | Preset | Para qué |
|---|---|---|
| [[App|App.jsx]] `<ViewSlot>` | `fadeUp` | Transición entre vistas top-level (Home → Library → Profile…). |
| [[HomeRow]] | `stagger` | Entrada secuencial de cards (35ms entre cada una). |

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Quitar `clearProps` | Hover/focus rompen tras la animación |
| Mover `mm.revert()` fuera del cleanup | Memory leaks + animaciones zombie en remounts rápidos |
| Cambiar default duration | Re-validar percepción en mobile (320ms es el sweet spot Material 3) |
| Quitar reduced-motion branch | Usuarios con accessibility setting ven animaciones |

## Casos de borde

- **`ref.current` null al mount** (componente condicional): el `useEffect` retorna sin hacer nada; cuando el ref aparece, el hook NO se re-dispara hasta que cambie alguna `dep`.
- **`disabled=true`**: el `useEffect` retorna sin tocar el DOM. Útil para condicionar la animación a un setting o feature flag.
- **Stagger sobre un container con muchos children dinámicos**: el preset captura los children en el momento del mount; los añadidos posteriormente NO se animan.

## Changelog

- 2026-05-27 — Creado en Fase 1.3. Ver `8a8ae5b` (`docs(fase-1): completada`).
