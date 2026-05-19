/**
 * Hook que detecta si estamos en viewport mobile via matchMedia.
 * Reactivo: se re-evalua si el viewport cambia (rotacion, resize).
 *
 * Combinarlo con `isDesktop` de api.js da el criterio
 * "PWA mobile" (vs Electron desktop): en Electron isDesktop=true
 * aunque la ventana sea angosta, asi que NO debe usar BottomSheet.
 *
 * @module @ritmiq/ui/lib/use-mobile-viewport
 */
import { useEffect, useState } from 'react';

export function useMobileViewport(breakpoint = 768) {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [breakpoint]);
  return mobile;
}
