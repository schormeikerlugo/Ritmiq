/**
 * Navegación con el mando de la TV (app de Google TV, `VITE_TARGET=tv`).
 *
 *  - Flechas: navegación espacial. Desde el elemento enfocado se elige el
 *    más cercano en esa dirección (distancia en el eje + 2× desvío lateral)
 *    y se enfoca, desplazando la pantalla lo justo. Sin foco, la primera
 *    flecha enfoca el contenido principal.
 *  - Campos de texto: ←/→ mueven el cursor salvo en los extremos; ↑/↓ salen.
 *    Sliders: ←/→ los ajusta el propio control; ↑/↓ salen.
 *  - Con una ventana abierta (role=dialog), la navegación queda dentro.
 *  - OK sobre elementos con role=button sin activación nativa → click().
 *  - Atrás y Canal ^/v llegan desde MainActivity (Android) vía
 *    `window.__ritmiqTvBack()` y `window.__ritmiqTvKey(name)`.
 *
 * @module @ritmiq/ui/lib/tv-nav
 */

import { useEffect } from 'react';

export const IS_TV = import.meta.env?.VITE_TARGET === 'tv';

if (IS_TV && typeof document !== 'undefined') {
  document.documentElement.dataset.tv = '1';
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  '[role="button"]', '[role="slider"]', '[role="tab"]', '[role="option"]', '[role="menuitem"]',
].join(',');

const DIRS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};

/** Raíz de navegación: la ventana superior abierta o el documento. */
function navRoot() {
  const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
    .filter(isVisible);
  return dialogs.length ? dialogs[dialogs.length - 1] : document.body;
}

function isVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
}

function candidates(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(isVisible);
}

/**
 * Mejor candidato en la dirección dada desde el rect `from`.
 * @param {DOMRect} from
 * @param {'up'|'down'|'left'|'right'} dir
 * @param {Element[]} list
 */
function pick(from, dir, list, current) {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === current || el.contains(current)) continue;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    let main;
    let cross;
    if (dir === 'right') { if (r.left < from.right - 4 && ex <= cx + 4) continue; main = Math.max(0, r.left - from.right); cross = overlap1d(from.top, from.bottom, r.top, r.bottom) ? 0 : Math.abs(ey - cy); }
    else if (dir === 'left') { if (r.right > from.left + 4 && ex >= cx - 4) continue; main = Math.max(0, from.left - r.right); cross = overlap1d(from.top, from.bottom, r.top, r.bottom) ? 0 : Math.abs(ey - cy); }
    else if (dir === 'down') { if (r.top < from.bottom - 4 && ey <= cy + 4) continue; main = Math.max(0, r.top - from.bottom); cross = overlap1d(from.left, from.right, r.left, r.right) ? 0 : Math.abs(ex - cx); }
    else { if (r.bottom > from.top + 4 && ey >= cy - 4) continue; main = Math.max(0, from.top - r.bottom); cross = overlap1d(from.left, from.right, r.left, r.right) ? 0 : Math.abs(ex - cx); }
    const score = main + cross * 2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

function overlap1d(a1, a2, b1, b2) {
  return Math.min(a2, b2) - Math.max(a1, b1) > 4;
}

/**
 * Enfoca `el` (aunque no sea tabulable) y lo trae a la vista. En vertical se
 * centra: así nunca queda pegado al borde, medio tapado (y la siguiente ↑/↓
 * calcula bien la dirección).
 * @param {Element} el
 * @param {'up'|'down'|'left'|'right'} [dir]
 */
export function tvFocus(el, dir) {
  if (!el) return;
  if (!el.matches('a[href], button, input, select, textarea, [tabindex]')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  const vertical = dir === 'up' || dir === 'down';
  el.scrollIntoView({ block: vertical ? 'center' : 'nearest', inline: 'nearest' });
}

/** Enfoca el primer elemento del contenido principal (no el menú lateral). */
export function focusMain() {
  const root = navRoot();
  const main = root === document.body ? (document.querySelector('main') ?? root) : root;
  const first = candidates(main)[0] ?? candidates(root)[0];
  tvFocus(first);
}

function isTextField(el) {
  return el instanceof HTMLTextAreaElement
    || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(el.type));
}

function isSlider(el) {
  return (el instanceof HTMLInputElement && el.type === 'range') || el.getAttribute?.('role') === 'slider';
}

function onKeyDown(e) {
  const dir = DIRS[e.key];
  const active = document.activeElement;
  const hasFocus = active && active !== document.body && active !== document.documentElement;

  if (e.key === 'Enter' && hasFocus && !active.matches('a[href], button, input, select, textarea')) {
    e.preventDefault();
    active.click();
    return;
  }
  if (!dir || e.ctrlKey || e.altKey || e.metaKey) return;

  if (hasFocus && isTextField(active)) {
    const len = active.value?.length ?? 0;
    if (dir === 'left' && active.selectionStart > 0) return;
    if (dir === 'right' && active.selectionEnd < len) return;
  }
  if (hasFocus && isSlider(active) && (dir === 'left' || dir === 'right')) return;

  e.preventDefault();
  e.stopPropagation();
  const root = navRoot();
  if (!hasFocus || !root.contains(active)) { focusMain(); return; }
  const next = pick(active.getBoundingClientRect(), dir, candidates(root), active);
  if (next) tvFocus(next, dir);
}

let installed = false;

/** Instala la navegación con el mando (solo en la app de TV). */
export function installTvNav() {
  if (!IS_TV || installed || typeof window === 'undefined') return;
  installed = true;
  // Fase de captura: antes que cualquier atajo o componente.
  window.addEventListener('keydown', onKeyDown, true);
}

/**
 * Registra los manejadores que invoca MainActivity (Android).
 * @param {{ onBack: () => ('handled'|'exit'), onKey: (name: string) => void }} handlers
 */
export function useTvRemote({ onBack, onKey }) {
  useEffect(() => {
    if (!IS_TV) return undefined;
    installTvNav();
    window.__ritmiqTvBack = onBack;
    window.__ritmiqTvKey = onKey;
    return () => {
      delete window.__ritmiqTvBack;
      delete window.__ritmiqTvKey;
    };
  }, [onBack, onKey]);
}

/** ¿Hay una ventana abierta? Se cierra simulando Escape (Modal/BottomSheet lo escuchan). */
export function closeTopDialog() {
  const root = navRoot();
  if (root === document.body) return false;
  const target = document.activeElement && document.activeElement !== document.body
    ? document.activeElement : document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
}
