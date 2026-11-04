/**
 * Modo de rendimiento ("Reducir efectos").
 *
 * En aparatos modestos (la app de Google TV en un onn. con 4× Cortex-A35 y
 * 1,4 GB de RAM) las animaciones infinitas, los desenfoques y las sombras
 * mantenían la CPU en ~190 % con la app quieta. En modo ligero:
 *   - CSS (`html[data-perf='low']`, global.css): animaciones y transiciones
 *     saltan al estado final, sin backdrop-filter, sombras ni filtros.
 *   - JS: sin GSAP, pulso BPM, visualizador, crossfade, EQ ni ventanas
 *     automáticas (resumen del mes).
 *
 * Preferencia del usuario (localStorage): 'auto' (por defecto), 'on', 'off'.
 * 'auto' activa el modo en builds que lo fuerzan (VITE_PERF_LOW=1, app de TV)
 * o en aparatos con ≤ 2 GB de RAM o ≤ 2 núcleos.
 *
 * @module @ritmiq/ui/lib/perf-mode
 */

const LS_KEY = 'ritmiq:perf:reduceEffects';
const BUILD_LOW = import.meta.env?.VITE_PERF_LOW === '1';

/** @returns {'auto'|'on'|'off'} */
export function getReduceEffectsPref() {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** ¿El modo 'auto' activaría el modo ligero en este aparato? */
export function isLowEndDevice() {
  if (BUILD_LOW) return true;
  if (typeof navigator === 'undefined') return false;
  const mem = Number(navigator.deviceMemory);
  const cores = Number(navigator.hardwareConcurrency);
  return (Number.isFinite(mem) && mem > 0 && mem <= 2)
    || (Number.isFinite(cores) && cores > 0 && cores <= 2);
}

function compute() {
  const pref = getReduceEffectsPref();
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return isLowEndDevice();
}

let low = compute();

function apply() {
  if (typeof document === 'undefined') return;
  if (low) document.documentElement.dataset.perf = 'low';
  else delete document.documentElement.dataset.perf;
}
apply();

/** true si la app debe evitar efectos caros. */
export function isLowPerf() {
  return low;
}

/**
 * Cambia la preferencia. Los efectos JS ya montados no se re-evalúan en
 * caliente; el CSS sí. La UI de Ajustes recomienda recargar.
 * @param {'auto'|'on'|'off'} pref
 */
export function setReduceEffectsPref(pref) {
  try {
    if (pref === 'auto') localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, pref);
  } catch {}
  low = compute();
  apply();
}
