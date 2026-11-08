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
  // Botones de cabecera (avatar, buscar…) marcados con data-tv-skip-initial:
  // al entrar en una página el foco va al contenido, no a ellos.
  const list = candidates(main);
  const first = list.find((el) => !el.closest('[data-tv-skip-initial]')) ?? list[0] ?? candidates(root)[0];
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

/* ── Zonas ─────────────────────────────────────────────────────────────
 * La pantalla se divide en zonas (atributo data-tv-zone en App.jsx): menu,
 * content (buscador + página), player y queue (si está abierta). Las flechas
 * no salen de la zona; para cambiar se usa la CAPA DE ZONAS (Atrás en una
 * página principal o desde menú/reproductor): ← Menú, → Contenido/Cola,
 * ↓ Reproductor, OK entra. Cada zona recuerda su último elemento. */

export const ZONE_LABELS = { menu: 'Menú', content: 'Contenido', player: 'Reproductor', queue: 'Cola' };

/** @param {Element|null} el */
export function zoneOf(el) {
  return el?.closest?.('[data-tv-zone]')?.getAttribute('data-tv-zone') ?? null;
}

/** Elementos (visibles) de cada zona. */
function zoneEls(zone) {
  return [...document.querySelectorAll(`[data-tv-zone="${zone}"]`)].filter((z) => {
    const r = z.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && getComputedStyle(z).display !== 'none';
  });
}

/** Zonas presentes ahora. */
export function availableZones() {
  return ['menu', 'content', 'queue', 'player'].filter((z) => zoneEls(z).length > 0);
}

/** Rectángulo que abarca todos los elementos de la zona. */
export function zoneRect(zone) {
  const rs = zoneEls(zone).map((z) => z.getBoundingClientRect());
  if (!rs.length) return null;
  const left = Math.min(...rs.map((r) => r.left));
  const top = Math.min(...rs.map((r) => r.top));
  const right = Math.max(...rs.map((r) => r.right));
  const bottom = Math.max(...rs.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** @type {Record<string, Element>} */
const lastFocus = {};
let currentZone = null;

function setZoneAttr(zone) {
  currentZone = zone;
  if (zone) document.documentElement.dataset.tvZone = zone;
  else delete document.documentElement.dataset.tvZone;
}

function onFocusIn(e) {
  const el = e.target;
  if (navRoot() !== document.body) return; // ventanas: no cuentan como zona
  const z = zoneOf(el);
  if (!z) return;
  lastFocus[z] = el;
  setZoneAttr(z);
}

export function getCurrentZone() { return currentZone; }

/** Entra en una zona: último elemento recordado o el primero razonable. */
export function focusZone(zone) {
  const last = lastFocus[zone];
  if (last && document.contains(last) && isVisible(last) && zoneOf(last) === zone) { tvFocus(last); return; }
  if (zone === 'content') { focusMain(); return; }
  const els = zoneEls(zone);
  const list = els.flatMap((z) => candidates(z));
  const pref = zone === 'player'
    ? list.find((b) => /^(Pausar|Reproducir)$/.test(b.getAttribute('aria-label') ?? ''))
    : zone === 'menu'
      ? list.find((b) => b.getAttribute('aria-current') === 'page' || b.dataset.active === 'true')
      : null;
  tvFocus(pref ?? list[0]);
}

// Capa de zonas.
let layer = { open: false, selected: null };
function emitLayer() {
  if (layer.open && layer.selected) document.documentElement.dataset.tvLayer = layer.selected;
  else delete document.documentElement.dataset.tvLayer;
  window.dispatchEvent(new CustomEvent('ritmiq:tv-zone-layer', { detail: { ...layer } }));
}
export function isZoneLayerOpen() { return layer.open; }
export function openZoneLayer() {
  const zones = availableZones();
  layer = { open: true, selected: zones.includes(currentZone) ? currentZone : 'content' };
  emitLayer();
}
/** Cierra la capa y entra en `zone` (o en la seleccionada). */
export function closeZoneLayer(zone) {
  const target = zone ?? layer.selected ?? 'content';
  layer = { open: false, selected: null };
  emitLayer();
  focusZone(target);
}

const LAYER_MOVES = {
  left: { content: 'menu', queue: 'content', player: 'menu' },
  right: { menu: 'content', content: 'queue', player: 'content' },
  down: { menu: 'player', content: 'player', queue: 'player' },
  up: { player: 'content' },
};

function onLayerKey(e) {
  const dir = DIRS[e.key];
  if (e.key === 'Enter') { closeZoneLayer(); return true; }
  if (!dir) return e.key !== 'Escape'; // Atrás lo resuelve App.jsx
  const next = LAYER_MOVES[dir][layer.selected];
  if (next && availableZones().includes(next)) {
    layer = { ...layer, selected: next };
    emitLayer();
  }
  return true;
}

// Aviso (pocas veces) de cómo cambiar de zona al chocar con el borde.
let edgeHints = 0;
function edgeHint() {
  let seen = 0;
  try { seen = Number(localStorage.getItem('ritmiq:tv:zoneHint') || 0); } catch {}
  if (seen >= 3 || edgeHints >= 1) return;
  edgeHints++;
  try { localStorage.setItem('ritmiq:tv:zoneHint', String(seen + 1)); } catch {}
  window.dispatchEvent(new CustomEvent('ritmiq:tv-zone-hint'));
}

/* ── Barras horizontales (tiempo, crossfade…): se activan con OK ───────
 * Sin activar, las flechas pasan por encima como por cualquier botón (si no,
 * cruzar la barra de tiempo hacia la cola movía la canción). OK la activa
 * (← → la mueven); OK, Atrás, ↑ o ↓ la sueltan. Las verticales del EQ no
 * cambian (←→ banda, ↑↓ ajustan). */
let engaged = null;

function isHorizontalSlider(el) {
  return !!el && isSlider(el) && el.dataset?.tvAxis !== 'vertical';
}
function engage(el) {
  engaged = el;
  el.setAttribute('data-tv-engaged', '');
  el.addEventListener('blur', releaseSlider, { once: true });
}
/** Suelta la barra activada. Devuelve true si había una (Atrás lo usa). */
export function releaseSlider() {
  if (!engaged) return false;
  engaged.removeAttribute('data-tv-engaged');
  engaged = null;
  return true;
}

// Pista (2 veces en total) al pasar por una barra: "OK para moverla".
let sliderHints = 0;
function sliderHint() {
  let seen = 0;
  try { seen = Number(localStorage.getItem('ritmiq:tv:sliderHint') || 0); } catch {}
  if (seen >= 2 || sliderHints >= 1) return;
  sliderHints++;
  try { localStorage.setItem('ritmiq:tv:sliderHint', String(seen + 1)); } catch {}
  window.dispatchEvent(new CustomEvent('ritmiq:tv-slider-hint'));
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
  if (layer.open && navRoot() === document.body) {
    if (onLayerKey(e)) { e.preventDefault(); e.stopPropagation(); }
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

  // OK sobre una barra horizontal: activarla / soltarla.
  if (e.key === 'Enter' && hasFocus && isHorizontalSlider(active)) {
    e.preventDefault();
    e.stopPropagation();
    if (engaged === active) releaseSlider(); else { releaseSlider(); engage(active); }
    return;
  }

  if (e.key === 'Enter' && hasFocus && !active.matches('a[href], button, input, select, textarea')) {
    e.preventDefault();
    const inner = active.querySelector('button, a[href]');
    (inner ?? active).click();
    return;
  }
  // OK en el menú: tras abrir la sección, el foco pasa al contenido (aunque
  // sea la misma sección y no cambie la vista).
  if (e.key === 'Enter' && hasFocus && zoneOf(active) === 'menu' && navRoot() === document.body) {
    setTimeout(() => { if (zoneOf(document.activeElement) === 'menu') focusZone('content'); }, 400);
  }
  if (!dir || e.ctrlKey || e.altKey || e.metaKey) return;

  if (hasFocus && isTextField(active)) {
    const len = active.value?.length ?? 0;
    if (dir === 'left' && active.selectionStart > 0) return;
    if (dir === 'right' && active.selectionEnd < len) return;
  }
  if (hasFocus && isSlider(active)) {
    // Verticales (bandas del EQ): ↑/↓ los ajusta el propio control, ←/→
    // navegan. Horizontales: solo si están activadas (OK); ↑/↓ las sueltan.
    const vertical = active.dataset?.tvAxis === 'vertical';
    if (vertical && (dir === 'up' || dir === 'down')) return;
    if (!vertical) {
      if (engaged === active && (dir === 'left' || dir === 'right')) return;
      releaseSlider();
    }
  }

  e.preventDefault();
  e.stopPropagation();
  const root = navRoot();
  if (!hasFocus || !root.contains(active)) { focusMain(); return; }
  // Zonas: sin salir de la del elemento enfocado (fuera de ventanas).
  let list = candidates(root);
  const zone = root === document.body ? zoneOf(active) : null;
  if (zone) list = list.filter((el) => zoneOf(el) === zone);
  const next = pick(active.getBoundingClientRect(), dir, list, active);
  if (next) {
    tvFocus(next, dir);
    if (isHorizontalSlider(next)) sliderHint();
  } else if (zone && pick(active.getBoundingClientRect(), dir, candidates(root), active)) edgeHint();
}

let installed = false;

/** Instala la navegación con el mando (solo en la app de TV). */
export function installTvNav() {
  if (!IS_TV || installed || typeof window === 'undefined') return;
  installed = true;
  // Fase de captura: antes que cualquier atajo o componente.
  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusin', onFocusIn, true);
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
