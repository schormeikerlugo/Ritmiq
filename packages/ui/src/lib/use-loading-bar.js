/**
 * Barra de carga sobre la barra de tiempo: mientras use-player carga una
 * canción (`isLoading`), las barras de progreso muestran cuánto lleva
 * cargando en vez de la posición. Al empezar a sonar saltan al 100% un
 * instante ("Listo en X s") y vuelven a ser la barra de tiempo normal.
 *
 * El tiempo total de carga no se conoce de antemano, así que el relleno
 * sigue una curva asintótica hacia el 95% (rápida al principio, lenta
 * después) y el contador muestra el tiempo real transcurrido.
 *
 * @module @ritmiq/ui/lib/use-loading-bar
 */

import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../stores/player.js';

const TICK_MS = 100;
const DONE_MS = 600;
// Constante de tiempo de la curva: ~52% a los 2s, ~76% a los 4s, ~89% a los 7s.
const TAU_MS = 2500;

/**
 * @typedef {Object} LoadingBar
 * @property {'idle'|'loading'|'done'} phase
 * @property {number} pct        0-100 (solo relevante si phase !== 'idle').
 * @property {number} elapsedMs  Tiempo de carga (en 'done', el total final).
 */

/** @returns {LoadingBar} */
export function useLoadingBar() {
  const isLoading = usePlayerStore((s) => s.isLoading && !!s.currentTrack);
  const startedAt = usePlayerStore((s) => s.loadingStartedAt);
  const hasError = usePlayerStore((s) => !!s.error);
  const [now, setNow] = useState(() => Date.now());
  const [doneMs, setDoneMs] = useState(/** @type {number|null} */ (null));
  const wasLoadingRef = useRef(false);

  useEffect(() => {
    if (!isLoading) return undefined;
    setDoneMs(null);
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [isLoading, startedAt]);

  useEffect(() => {
    const was = wasLoadingRef.current;
    wasLoadingRef.current = isLoading;
    if (!was || isLoading || hasError || !startedAt) return undefined;
    // Terminó bien: mostrar el total un instante y volver a la normalidad.
    setDoneMs(Date.now() - startedAt);
    const id = setTimeout(() => setDoneMs(null), DONE_MS);
    return () => clearTimeout(id);
  }, [isLoading, hasError, startedAt]);

  if (isLoading) {
    const elapsedMs = Math.max(0, now - startedAt);
    return { phase: 'loading', pct: 95 * (1 - Math.exp(-elapsedMs / TAU_MS)), elapsedMs };
  }
  if (doneMs != null) return { phase: 'done', pct: 100, elapsedMs: doneMs };
  return { phase: 'idle', pct: 0, elapsedMs: 0 };
}

/** '2,3 s' (una décima; separador decimal local). */
export function formatLoadingSeconds(ms) {
  return `${(ms / 1000).toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}
