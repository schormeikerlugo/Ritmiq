/**
 * Hook que bloquea el scroll del <body> mientras un modal/sheet esta
 * abierto. Restaura el overflow previo al desmontar.
 *
 * Usado por Modal y por NowPlaying. Stackeable: si dos modales abren
 * simultaneamente, el body sigue locked hasta que ambos cierren — el
 * contador global se incrementa al lock y decrementa al unlock.
 *
 * @module @ritmiq/ui/lib/use-lock-body-scroll
 */
import { useEffect } from 'react';

let lockCount = 0;
let savedOverflow = '';
let savedPaddingRight = '';

function applyLock() {
  // Compensa el scrollbar para que la pagina no salte al bloquearse.
  const sbw = window.innerWidth - document.documentElement.clientWidth;
  if (sbw > 0) {
    savedPaddingRight = document.body.style.paddingRight;
    document.body.style.paddingRight = `${sbw}px`;
  }
  savedOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}

function applyUnlock() {
  document.body.style.overflow = savedOverflow;
  document.body.style.paddingRight = savedPaddingRight;
  savedOverflow = '';
  savedPaddingRight = '';
}

/**
 * @param {boolean} [active=true] Si false, no aplica el lock (util para
 *   condicionar el hook a un state — ej. `useLockBodyScroll(isOpen)`).
 */
export function useLockBodyScroll(active = true) {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) applyLock();
    lockCount++;
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) applyUnlock();
    };
  }, [active]);
}
