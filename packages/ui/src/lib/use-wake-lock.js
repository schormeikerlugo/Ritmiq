/**
 * useWakeLock — mantiene la pantalla encendida mientras el flag esta
 * activo. Solo usar cuando hay una buena razon UX (cover gigante en
 * NowPlaying, lyrics scrolleando, video, etc.) \u2014 abusar drena bateria.
 *
 * Soporte:
 *   - iOS PWA 16.4+ \u2014 funciona.
 *   - Android Chrome \u2014 funciona desde Chrome 84+.
 *   - Desktop Chrome/Edge \u2014 funciona.
 *   - Firefox \u2014 no soportado.
 *   - Safari iOS no-PWA (browser tab) \u2014 no soportado.
 *
 * iOS reseta el wake lock cuando la pestana entra en background. Si
 * el usuario vuelve a foreground, hay que re-pedirlo. Por eso el
 * hook escucha visibilitychange y re-acquire si sigue activo.
 *
 * @module @ritmiq/ui/lib/use-wake-lock
 */

import { useEffect, useRef } from 'react';

/**
 * @param {boolean} active - si true, mantiene la pantalla encendida.
 *   Cambiar a false libera el lock inmediatamente.
 */
export function useWakeLock(active) {
  // Guardamos el sentinel (WakeLockSentinel) para poder release() limpio.
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (!isWakeLockSupported()) return;

    let cancelled = false;

    async function acquire() {
      if (sentinelRef.current) return; // ya tenemos uno
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          // El componente se re-renderizo con active=false antes de
          // que llegara la promise; liberar inmediatamente.
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        // El sentinel puede ser liberado externamente (iOS al
        // backgroundar la app). Limpiamos la ref para que el siguiente
        // re-acquire intente de nuevo.
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch {
        // NotAllowedError (sin permiso), AbortError (otro lock activo),
        // o navigator.wakeLock undefined. Silencioso \u2014 no es critico.
      }
    }

    async function release() {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel) {
        try { await sentinel.release(); } catch {}
      }
    }

    if (active) {
      acquire();
      // Re-acquire al volver del background \u2014 iOS libera el lock
      // cuando la app entra en background, sin notificarnos.
      const onVisibility = () => {
        if (document.visibilityState === 'visible' && active) acquire();
      };
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        cancelled = true;
        document.removeEventListener('visibilitychange', onVisibility);
        release();
      };
    } else {
      release();
    }

    return () => { cancelled = true; };
  }, [active]);
}

function isWakeLockSupported() {
  if (typeof navigator === 'undefined') return false;
  return 'wakeLock' in navigator;
}
