---
tipo: hook
capa: ui
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-badge.js
tags: [hook, badge, notificaciones, pwa, ios]
---

# `useAppBadge(count, autoClearOnViewing?)`

> Sincroniza el badge del icono de la app (Badging API nativa) con un contador de items pendientes. Debounce 200ms, guard de permiso iOS.

## Ubicación
`packages/ui/src/lib/use-badge.js:1` (91 líneas)

## Firma

```js
function useAppBadge(count: number, autoClearOnViewing?: boolean): void
function clearAppBadge(): void   // helper imperativo
```

## Soporte

| Plataforma | Estado |
|---|---|
| iOS PWA 16.4+ | ✓ (requiere permiso de Notificaciones) |
| Android Chrome (instalada) | ✓ |
| Desktop PWA Chrome/Edge | ✓ |
| Safari iOS (no instalada) | ✗ |
| Firefox | ✗ |

## Anatomía del código (snippet clave)

### Debounce + guard de cambio
`packages/ui/src/lib/use-badge.js:45-74`

```js
const target = autoClearOnViewing ? 0 : Math.max(0, count | 0);

if (target === lastValueRef.current) return;  // skip si no cambió

if (timeoutRef.current) clearTimeout(timeoutRef.current);
timeoutRef.current = setTimeout(() => {
  lastValueRef.current = target;
  try {
    if (target === 0) {
      navigator.clearAppBadge?.().catch(() => {});
    } else {
      navigator.setAppBadge?.(target).catch(() => {});
    }
  } catch { /* SecurityError — silencioso */ }
}, 200);
```

**Por qué debounce 200ms**: cuando llegan 3 shares en 50ms (burst de Realtime), sin debounce se harían 3 llamadas al SO en lugar de 1. El SO actualiza el badge cada vez y puede introducir lag visual.

**Por qué `count | 0`**: normaliza a entero. Si por bug llega un float (ej. 2.7), el badge mostraría un número no entero. `| 0` trunca a entero de forma eficiente.

**Por qué `lastValueRef`**: skip de escrituras al SO cuando el badge no cambia. Reduce overhead de IPC con el SO.

## Casos de borde

- **Sin permiso de notificaciones en iOS**: `setAppBadge` no falla pero no hace nada visible. No hay API para detectar si el badge se mostró realmente.
- **App en background**: iOS puede resetear el badge. El hook no detecta esto; al volver a foco el badge puede no coincidir con el contador en memoria. Aceptable.

## Dependencias entrantes
- [[FriendsView]] → `useAppBadge(pendingCount, isViewingFriends)`.

## Dependencias salientes
- `navigator.setAppBadge`, `navigator.clearAppBadge` (Web Badging API).

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar debounce | 3 llamadas al SO por burst de Realtime → lag visual en el icono. |
| Quitar guard `lastValueRef` | Badge se re-escribe aunque no cambió → overhead innecesario. |

## Notas / Changelog
- 2026-05-22: nivel medio.
