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
let savedBodyOverflow = '';
let savedHtmlOverflow = '';
let savedPaddingRight = '';
/** @type {Array<{el:Element, prevOverflow:string, prevTouchAction:string}>} */
let savedScrollers = [];

/**
 * Selectores de elementos que actuan como scroll containers en la app.
 * Necesitan ser bloqueados ademas del body porque el shell de Ritmiq
 * delega el scroll en `.main` (no en el body) — bloquear solo body
 * dejaba la pagina de fondo scrolleable mientras el modal estaba abierto.
 *
 * Los selectores son class-names CSS-modules generados por Vite con un
 * hash al final (ej. `_main_3xy2z`). Usamos `[class*="main"]` para
 * matchear cualquier hash sin acoplarnos al build.
 */
const SCROLL_LOCK_SELECTORS = [
  'main',
  '[class*="main_"]',
  '[class*="scrollContainer_"]',
];

function applyLock() {
  // Compensa el scrollbar para que la pagina no salte al bloquearse.
  const sbw = window.innerWidth - document.documentElement.clientWidth;
  if (sbw > 0) {
    savedPaddingRight = document.body.style.paddingRight;
    document.body.style.paddingRight = `${sbw}px`;
  }
  savedBodyOverflow = document.body.style.overflow;
  savedHtmlOverflow = document.documentElement.style.overflow;
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';

  // Lock todos los scroll containers conocidos.
  savedScrollers = [];
  for (const sel of SCROLL_LOCK_SELECTORS) {
    const nodes = document.querySelectorAll(sel);
    for (const el of nodes) {
      const htmlEl = /** @type {HTMLElement} */ (el);
      savedScrollers.push({
        el,
        prevOverflow: htmlEl.style.overflow,
        prevTouchAction: htmlEl.style.touchAction,
      });
      htmlEl.style.overflow = 'hidden';
      // touchAction:none previene swipe scroll inercial en iOS sobre
      // el contenedor lockeado.
      htmlEl.style.touchAction = 'none';
    }
  }
}

function applyUnlock() {
  document.body.style.overflow = savedBodyOverflow;
  document.documentElement.style.overflow = savedHtmlOverflow;
  document.body.style.paddingRight = savedPaddingRight;
  savedBodyOverflow = '';
  savedHtmlOverflow = '';
  savedPaddingRight = '';

  for (const { el, prevOverflow, prevTouchAction } of savedScrollers) {
    const htmlEl = /** @type {HTMLElement} */ (el);
    htmlEl.style.overflow = prevOverflow;
    htmlEl.style.touchAction = prevTouchAction;
  }
  savedScrollers = [];
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
