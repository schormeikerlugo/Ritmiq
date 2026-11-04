---
tipo: helper
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-11-04
archivo: packages/ui/src/lib/perf-mode.js
tags:
  - helper
  - rendimiento
  - tv
  - accesibilidad
---

# `perf-mode.js` — "Reducir efectos"

> Modo ligero para aparatos modestos (onn. Google TV: 4× Cortex-A35, 1,4 GB). Se importa primero en `packages/ui/src/index.js` y marca `<html data-perf="low">`.

## API
| Función | Qué hace |
|---|---|
| `isLowPerf()` | `true` si la app debe evitar efectos caros. |
| `isLowEndDevice()` | Lo que haría 'auto': build con `VITE_PERF_LOW=1` (app TV) o `deviceMemory ≤ 2` o `hardwareConcurrency ≤ 2`. |
| `getReduceEffectsPref()` / `setReduceEffectsPref('auto'\|'on'\|'off')` | Preferencia en `localStorage['ritmiq:perf:reduceEffects']`. Ajustes → Apariencia → "Reducir efectos". |

## Efectos del modo
- **CSS** (`global.css`): `animation-duration: 1ms; iteration-count: 1` (las infinitas se detienen; entradas/salidas quedan en su estado final por el fill-mode y `animationend` se emite), sin transiciones, `backdrop-filter`, `box-shadow`, `text-shadow`, `filter` ni `will-change`.
- **HomeRow**: `content-visibility: auto` en filas y tarjetas (no se pintan fuera de pantalla).
- **JS**: sin GSAP (`use-view-transition`), pulso BPM, visualizador, crossfade (`canCrossfade`), ni `MonthlyWrappedAutoTrigger`.

## Medido en el onn. (2026-11-04)
| | Antes | Después |
|---|---|---|
| CPU de la app en reposo (Inicio) | 180–190 % | 0–6 % |
| Fotogramas (mediana / p90) | 29 / 32 ms (85 ms con ventana abierta) | 18 / 20 ms |
| Memoria gráfica | 115 MB | 96 MB |
| Arranque (Activity) | 4,3 s | 4,0 s |
| Animaciones en marcha | — | 0 |

Navegar: Biblioteca ~260–300 ms, Descargas/Amigos/Ajustes ~110–150 ms, Inicio ~360 ms (670 ms la primera vez).

## Notas / Changelog
- 2026-11-04: creación (ADR-041).
