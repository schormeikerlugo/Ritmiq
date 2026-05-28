---
tipo: modulo
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/styles/tokens.css
tags: [motion, animation, gsap, tokens, accessibility]
---

# Sistema de Motion

> Fundación visual unificada para transiciones, micro-animaciones y respeto a `prefers-reduced-motion`. Creada en Fase 1 (commits `e7bff43` → `2766c51`).

## Por qué existe

Antes de Fase 1:
- Cada componente decidía su propia duración (entre 80ms y 400ms inconsistentes).
- 2 easings (`--ease-standard`, `--ease-emphasized`) sin nombres semánticos.
- `prefers-reduced-motion` se respetaba caso por caso (algunas animaciones lo cubrían, otras no).
- Sin animation engine JS centralizado → cada transición usaba CSS keyframes propios.

Tras Fase 1:
- Escala canónica `--duration-xs/sm/md/lg/xl`.
- 6 easings con nombres semánticos.
- Media query global que neutraliza todas las animaciones cuando el SO lo pide.
- Hook [[use-view-transition]] que envuelve GSAP para transiciones de entrada.

## Tokens (`tokens.css`)

### Durations

```css
--duration-xs: 80ms;     /* micro-feedback (hover, tap scale) */
--duration-sm: 120ms;    /* feedback inmediato (botones, focus rings) */
--duration-md: 200ms;    /* default UI (modales, paneles, listas) */
--duration-lg: 320ms;    /* transiciones de vista, navegación top-level */
--duration-xl: 500ms;    /* animaciones expresivas (splash, drawer) */
```

### Easings

```css
--ease-out:        cubic-bezier(0.0, 0.0, 0.2, 1);  /* ENTRADAS */
--ease-in:         cubic-bezier(0.4, 0.0, 1.0, 1);  /* SALIDAS */
--ease-inout:      cubic-bezier(0.4, 0.0, 0.2, 1);  /* movimientos A→B */
--ease-spring:     cubic-bezier(0.34, 1.56, 0.64, 1); /* overshoot sutil */
--ease-standard:   cubic-bezier(0.2, 0, 0, 1);      /* ease-out clásico Material */
--ease-emphasized: cubic-bezier(0.16, 1, 0.3, 1);   /* ease-out exagerado */
```

### Aliases legacy

```css
--dur-fast:   var(--duration-sm);
--dur-normal: var(--duration-md);
--dur-slow:   var(--duration-lg);
```

~206 usos existentes de `--dur-*` se preservan. Migración progresiva.

## Reduced-motion global

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

`1ms` en lugar de `0` para mantener disparo de eventos `transitionend` / `animationend` que código pueda esperar.

Las animaciones JS (GSAP) deben respetar reduced-motion **por su cuenta** — el reset CSS no las afecta. Ver [[use-view-transition]] que usa `gsap.matchMedia()`.

## GSAP como motion engine

Ver [[Decisiones-Tecnicas-ADR|ADR-008]].

- Versión: `gsap@3.15.0`.
- Instalado en `@ritmiq/ui` (peer en consumers Desktop + PWA).
- Sin `@gsap/react` (no añadimos otra dep; usamos `useEffect + mm.revert()` manual).
- Bundle impact: +66 KB gzipped al primer import.

## Patrones por capa

| Capa | Cuándo usar GSAP | Cuándo usar CSS |
|---|---|---|
| Transición entre vistas top-level | ✅ vía [[use-view-transition]] | ❌ |
| Stagger en listas grandes | ✅ vía [[use-view-transition]] preset `'stagger'` | ❌ (CSS stagger es awkward) |
| Modal slide-in / fade-in | ❌ | ✅ keyframes (`ritmiq-fade-in-up`) |
| Hover/focus rings, tap scale | ❌ | ✅ `transition` con tokens |
| Spinner, shimmer, vinyl-spin | ❌ | ✅ keyframes infinitas |
| Cover BPM pulse | ❌ JS | requestAnimationFrame en [[use-bpm-pulse]] |

## Tablas de equivalencia

| Token | Equivalente Material | Equivalente Apple HIG |
|---|---|---|
| `--duration-sm 120ms` | Small (M3) | Quick (HIG) |
| `--duration-md 200ms` | Medium (M3) | Standard (HIG) |
| `--duration-lg 320ms` | Large (M3) | Subtle (HIG) |
| `--ease-out` | Decelerate (M3) | Ease-out (HIG) |
| `--ease-spring` | n/a | Smooth (HIG) |

## Qué rompe esto

| Cambio | Síntoma |
|---|---|
| Quitar el reset reduced-motion | Usuarios con accessibility setting ven todas las animaciones |
| Cambiar el valor de `--dur-md` | ~206 componentes que usan `--dur-normal` se aceleran/desaceleran |
| Migrar todo a GSAP | +66 KB es OK; **+200 KB** si añadimos plugins ScrollTrigger/Flip/etc. sin justificar |
| Quitar los aliases `--dur-*` | Hay que migrar los 206 usos en un solo PR enorme |

## Notas / Changelog

- 2026-05-27 — Creado como parte de Fase 1 (5 commits + docs). Ver [[fase-1-completada|docs/fase-1-completada.md]] (en repo).
