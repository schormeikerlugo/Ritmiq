/**
 * Utilidades comunes para los variants de MilestoneToast.
 *
 * Funciones puras, sin imports externos. Cada variant las usa para
 * generar arrays de particulas con seeds reproducibles (mismo array
 * en cada render, evita re-pintar cuando react re-renderiza).
 *
 * @module @ritmiq/ui/components/MilestoneToast/lib/particle-helpers
 */

/**
 * Detecta si estamos en un device modesto (low-end) para reducir
 * cantidades de particulas y mantener 60fps.
 *
 * Heuristica: hardwareConcurrency < 4 (e.g. iPhone SE, Android low-end).
 * Sin acceso al DOM (SSR-safe).
 *
 * @returns {boolean}
 */
export function isLowEndDevice() {
  if (typeof navigator === 'undefined') return false;
  const cores = Number(navigator.hardwareConcurrency);
  return Number.isFinite(cores) && cores > 0 && cores < 4;
}

/**
 * Devuelve la cantidad de particulas ajustada al device.
 *
 * @param {number} full   cantidad para devices normales
 * @param {number} [reduced]  cantidad para low-end (default: floor(full/2))
 * @returns {number}
 */
export function particleCount(full, reduced) {
  if (!isLowEndDevice()) return full;
  return reduced ?? Math.max(1, Math.floor(full / 2));
}

/**
 * Genera N partículas con propiedades pseudo-aleatorias pero
 * reproducibles (mismas en cada llamada con misma seed/count).
 *
 * Cada particula es { i, delay, x, y, rot, hue, dur, scale }.
 * Los rangos los ajusta el caller con `mapper`.
 *
 * Usa formula linear-congruential sencilla para evitar Math.random()
 * (que produce diferentes valores en cada render → React tilda
 * "rendered different output" en strict mode).
 *
 * @param {number} count   cantidad de particulas a generar
 * @param {number} [seed]  semilla (default 1337). Cambiala para variar.
 * @returns {Array<{i:number, r1:number, r2:number, r3:number, r4:number}>}
 *   Cada particula tiene 4 valores en [0,1) deterministicos.
 */
export function generateParticles(count, seed = 1337) {
  const out = [];
  // LCG: state_{n+1} = (a*state_n + c) mod m. Constantes Numerical Recipes.
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let i = 0; i < count; i++) {
    out.push({
      i,
      r1: next(),
      r2: next(),
      r3: next(),
      r4: next(),
    });
  }
  return out;
}

/**
 * Mapea un valor en [0,1) a un rango [min, max].
 * @param {number} t
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function lerp(t, min, max) {
  return min + (max - min) * t;
}

/**
 * Detecta si el user prefiere movimiento reducido (sistema OS).
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
