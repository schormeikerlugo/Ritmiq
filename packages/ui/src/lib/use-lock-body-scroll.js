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
let savedPaddingRight = '';

/**
 * Mecanismo de lock por CSS class en el body. Mas robusto que manipular
 * inline styles porque:
 *  - El cleanup es atomico: removeAttribute / classList.remove no falla.
 *  - El CSS global controla TODO desde un solo punto, sin riesgo de
 *    olvidar restaurar inline styles individuales.
 *  - Reentrante: si N modales se abren simultaneamente, el contador
 *    decide cuando aplicar/quitar la clase (solo al pasar 0↔1).
 *
 * La clase la aplica un <style> global inyectado al primer uso. Bloquea:
 *  - <html> y <body> overflow:hidden + position fixed (preserva scroll)
 *  - cualquier elemento `<main>` o con class `main_*` (CSS modules con
 *    hash) o `scrollContainer_*`.
 */
const STYLE_ID = '__ritmiq_scroll_lock_style';
const LOCK_CLASS = 'ritmiq-scroll-locked';

function ensureStyleInjected() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html.${LOCK_CLASS},
    body.${LOCK_CLASS} {
      overflow: hidden !important;
      touch-action: none !important;
    }
    body.${LOCK_CLASS} main,
    body.${LOCK_CLASS} [class*="main_"],
    body.${LOCK_CLASS} [class*="scrollContainer_"] {
      overflow: hidden !important;
      touch-action: none !important;
    }
  `;
  document.head.appendChild(style);
}

function applyLock() {
  ensureStyleInjected();
  // Compensa el scrollbar para que la pagina no salte al bloquearse.
  const sbw = window.innerWidth - document.documentElement.clientWidth;
  if (sbw > 0) {
    savedPaddingRight = document.body.style.paddingRight;
    document.body.style.paddingRight = `${sbw}px`;
  }
  document.documentElement.classList.add(LOCK_CLASS);
  document.body.classList.add(LOCK_CLASS);
}

function applyUnlock() {
  document.documentElement.classList.remove(LOCK_CLASS);
  document.body.classList.remove(LOCK_CLASS);
  if (savedPaddingRight !== '') {
    document.body.style.paddingRight = savedPaddingRight;
  } else {
    document.body.style.removeProperty('padding-right');
  }
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
