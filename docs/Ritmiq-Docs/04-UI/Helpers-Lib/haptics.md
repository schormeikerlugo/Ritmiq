---
tipo: modulo
capa: ui
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/haptics.js
tags: [helper, haptics, vibracion, accesibilidad]
---

# `lib/haptics.js`

> Vibración sutil en acciones clave via `navigator.vibrate`. Respeta `prefers-reduced-motion`. No-op silencioso en iOS (WebKit ignora `vibrate`) y desktop.

## Ubicación
`packages/ui/src/lib/haptics.js:1` (71 líneas)

## Soporte

| Plataforma | Estado |
|---|---|
| Android Chrome | ✓ |
| iOS Safari/PWA | ✗ (WebKit ignora silenciosamente) |
| Desktop | ✗ (ignorado) |

## Exports

```js
function hapticTap(): void        // 10ms — confirmación ligera
function hapticSuccess(): void    // [15, 40, 15, 40, 25] — 3 pulsos crecientes
function hapticError(): void      // [60, 60, 60, 60, 60] — 3 pulsos largos
```

## Respeto a `prefers-reduced-motion`

Si el usuario activó "Reducir movimiento" en el sistema, se salta la vibración. Mismo principio que las animaciones CSS.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Quitar el check de `prefers-reduced-motion` | Vibración en dispositivos donde el usuario la pidió reducir. |
| `hapticTap()` con 200ms | Haptic demasiado fuerte para acciones cotidianas — molesto al cambiar tab. |

## Notas / Changelog
- 2026-05-22: nivel simple.
