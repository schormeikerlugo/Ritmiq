---
tipo: hook
capa: ui
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-wake-lock.js
tags: [hook, wake-lock, bateria, ios, pwa]
---

# `useWakeLock(active)`

> Mantiene la pantalla encendida mientras `active === true` usando Screen Wake Lock API. Gestiona el re-acquire automático al volver del background (iOS la libera al backgroundar).

## Ubicación
`packages/ui/src/lib/use-wake-lock.js:1` (90 líneas)

## Firma

```js
function useWakeLock(active: boolean): void
```

## Soporte

| Plataforma | Estado |
|---|---|
| iOS PWA 16.4+ | ✓ |
| Android Chrome | ✓ desde Chrome 84+ |
| Desktop Chrome/Edge | ✓ |
| Firefox | ✗ |
| Safari iOS (no instalada) | ✗ |

## Comportamiento iOS crítico

iOS libera el wake lock cuando la app entra en background, **sin emitir evento**. Por eso el hook escucha `visibilitychange` y re-acquiere cuando `document.visibilityState === 'visible'`.

## Anatomía del código (snippet clave)

### Race condition de async acquire
`packages/ui/src/lib/use-wake-lock.js:33-56`

```js
let cancelled = false;

async function acquire() {
  if (sentinelRef.current) return;  // ya tenemos uno
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    if (cancelled) {
      // El componente se re-renderizó con active=false ANTES de que
      // llegara la Promise. Liberar inmediatamente.
      sentinel.release().catch(() => {});
      return;
    }
    sentinelRef.current = sentinel;
    sentinel.addEventListener('release', () => {
      if (sentinelRef.current === sentinel) sentinelRef.current = null;
    });
  } catch {
    // NotAllowedError, AbortError, o undefined. Silencioso.
  }
}
```

**Por qué `cancelled`**: `navigator.wakeLock.request()` es async. Si el componente se desmonta o `active` cambia a `false` antes de que resuelva, tenemos un sentinel que nadie va a hacer `release()`. El flag `cancelled` detecta ese gap y libera inmediatamente.

**Por qué el listener `'release'`**: iOS puede liberar el sentinel externamente (background, llamada entrante). El evento limpia `sentinelRef` para que el siguiente `acquire()` intente de nuevo.

## Casos de borde

- **Múltiples renders**: `if (sentinelRef.current) return` previene adquirir dos sentinels simultáneos.
- **`active` false inicial**: el `else { release() }` del `useEffect` cubre el caso.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar flag `cancelled` | Sentinel adquirido después de `active=false` → pantalla nunca se apaga hasta desmontar. |
| Quitar listener `'release'` | iOS backgroundea la app → `sentinelRef` mantiene ref stale → `acquire()` no re-intenta al volver. |
| Quitar `visibilitychange` | iOS backgroundea → libera wake lock → usuario vuelve → pantalla se apaga al minuto. |

## Notas / Changelog
- 2026-05-22: nivel medio.
