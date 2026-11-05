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
  const all = [...root.querySelectorAll(FOCUSABLE)];
  // Sin contenedores que tengan controles dentro (p. ej. filas arrastrables
  // con role=button): se navega directo al botón interior, que es el que
  // reproduce/abre. Si no, OK caía en el contenedor y no hacía nada.
  // Pero un <button>/<a> de verdad sí cuenta (las filas de la Biblioteca son
  // botones con un "reproducir rápido" tabindex=-1 dentro): se navega a él y
  // se ignora lo de dentro marcado como no enfocable. Lo de dentro enfocable
  // a propósito (p. ej. "Cerrar" del aviso de descargas) sigue alcanzable.
  return all.filter((el) => isVisible(el)
    && !(el.getAttribute('tabindex') === '-1' && el.parentElement?.closest(NATIVE))
    && (el.matches(NATIVE) || !el.querySelector(FOCUSABLE)));
}

const NATIVE = 'button, a[href]';

const PRIMARY_RE = /^(continuar|siguiente|empezar|comenzar|aceptar|entendido|listo|ok|unirse|crear|guardar|recuperar|terminar|finalizar)\b/i;

/** Botón principal de una ventana: texto típico de avance, o el último botón. */
function primaryOf(root) {
  const btns = candidates(root).filter((el) => el.tagName === 'BUTTON');
  return btns.find((b) => b.hasAttribute('autofocus') || b.dataset.primary != null)
    ?? btns.find((b) => PRIMARY_RE.test((b.textContent || '').trim()))
    ?? btns[btns.length - 1]
    ?? null;
}

/**
 * Mejor candidato en la dirección dada desde el rect `from`.
 * @param {DOMRect} from
 * @param {'up'|'down'|'left'|'right'} dir
 * @param {Element[]} list
 */
function pick(from, dir, list, current) {
  const fromRegion = current ? regionOf(current) : null;
  const horizontal = dir === 'left' || dir === 'right';
  // En horizontal, si en la MISMA zona hay algo en la misma fila (p. ej. la
  // banda siguiente del EQ), gana a lo de otra zona aunque esté más cerca
  // (el reproductor de abajo). Si no lo hay, se cruza de zona libremente
  // (← desde el contenido va a la barra lateral).
  if (horizontal && fromRegion) {
    const sameRow = list.filter((el) => {
      if (regionOf(el) !== fromRegion) return false;
      const r = el.getBoundingClientRect();
      return overlap1d(from.top, from.bottom, r.top, r.bottom);
    });
    const best = pickScored(from, dir, sameRow, current, null);
    if (best) return best;
  }
  return pickScored(from, dir, list, current, horizontal ? null : fromRegion);
}

function pickScored(from, dir, list, current, fromRegion) {
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
    // En vertical, quedarse en la misma zona (contenido / barra lateral /
    // reproductor) mientras haya algo: un botón estrecho del contenido no
    // salta a la barra lateral.
    const penalty = fromRegion && regionOf(el) !== fromRegion ? 2000 : 0;
    // Vertical: la distancia en la dirección pesa más que la lateral (↓
    // desde un control a la derecha va a la fila de debajo, no a lo más
    // alineado varias filas más abajo). Horizontal: al revés, se prefiere la
    // misma altura (← desde una canción va a la barra lateral, no al botón
    // de arriba que queda algo a la izquierda).
    const vertical = dir === 'up' || dir === 'down';
    const score = (vertical ? main * 2 + cross : main + cross * 2) + penalty;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

function regionOf(el) {
  return el.closest('main, aside') ?? 'other';
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
  // Campo de texto: seleccionarlo NO abre el teclado de la TV (si no, el
  // teclado se queda con las flechas y la navegación parece atascada). OK lo
  // abre (ver onKeyDown).
  if (isTextField(el) && !el.hasAttribute('inputmode')) {
    el.setAttribute('inputmode', 'none');
    el.dataset.tvIm = '1';
    el.addEventListener('blur', restoreInputMode, { once: true });
  }
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

/**
 * OK sobre un campo de texto seleccionado con el mando. La WebView no pasa
 * ese OK a la página: lo llama MainActivity al soltar OK y, si devuelve
 * 'kb', muestra el teclado del sistema.
 */
function tvOk() {
  const el = document.activeElement;
  if (!el || !isTextField(el) || !el.dataset.tvIm) return '';
  el.removeAttribute('inputmode');
  delete el.dataset.tvIm;
  return 'kb';
}
if (IS_TV && typeof window !== 'undefined') window.__ritmiqTvOk = tvOk;

function restoreInputMode(e) {
  const el = e.target;
  if (el?.dataset?.tvIm) { el.removeAttribute('inputmode'); delete el.dataset.tvIm; }
}

function isTextField(el) {
  return el instanceof HTMLTextAreaElement
    || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(el.type));
}

function isSlider(el) {
  return (el instanceof HTMLInputElement && el.type === 'range') || el.getAttribute?.('role') === 'slider';
}

/**
 * Interceptor de teclas (p. ej. la pantalla "Reproduciendo" en reposo: la
 * primera tecla solo la despierta). Si devuelve true, la tecla se consume.
 * @type {null | ((e: KeyboardEvent) => boolean)}
 */
let keyInterceptor = null;
/** @param {(e: KeyboardEvent) => boolean} fn @returns {() => void} quitar */
export function setTvKeyInterceptor(fn) {
  keyInterceptor = fn;
  return () => { if (keyInterceptor === fn) keyInterceptor = null; };
}

function onKeyDown(e) {
  if (keyInterceptor?.(e)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const dir = DIRS[e.key];
  const active = document.activeElement;
  const hasFocus = active && active !== document.body && active !== document.documentElement;

  // Ventana abierta y foco fuera de ella (o perdido al cambiar de paso):
  // ir al botón principal; con OK, además pulsarlo (avanzar el carrusel).
  const root0 = navRoot();
  if (root0 !== document.body && (!hasFocus || !root0.contains(active)) && (e.key === 'Enter' || DIRS[e.key])) {
    const primary = primaryOf(root0);
    if (primary) {
      e.preventDefault();
      e.stopPropagation();
      tvFocus(primary);
      if (e.key === 'Enter') primary.click();
      return;
    }
  }

  if (e.key === 'Enter' && hasFocus && !active.matches('a[href], button, input, select, textarea')) {
    e.preventDefault();
    const inner = active.querySelector('button, a[href]');
    (inner ?? active).click();
    return;
  }
  if (!dir || e.ctrlKey || e.altKey || e.metaKey) return;

  if (hasFocus && isTextField(active)) {
    const len = active.value?.length ?? 0;
    if (dir === 'left' && active.selectionStart > 0) return;
    if (dir === 'right' && active.selectionEnd < len) return;
  }
  if (hasFocus && isSlider(active)) {
    // Sliders verticales (bandas del EQ): ↑/↓ los ajusta el propio control,
    // ←/→ navegan. Horizontales (posición, volumen): al revés.
    const vertical = active.dataset?.tvAxis === 'vertical';
    if (vertical && (dir === 'up' || dir === 'down')) return;
    if (!vertical && (dir === 'left' || dir === 'right')) return;
  }

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
