/**
 * Hook que fuerza un re-render periodico para que selectStreakState
 * cruce los umbrales horarios (12/18/23) sin que el user toque nada.
 *
 * - Estados que no necesitan tick (fulfilled, inactive, broken):
 *   no setInterval, cero CPU.
 * - Estados calm/danger/urgent: tick cada 60s (precision de 1 min
 *   suficiente para detectar cruces de umbral).
 * - Estado last-hour: tick cada 1s (countdown MM:SS necesita
 *   actualizacion por segundo).
 *
 * @module @ritmiq/ui/lib/use-streak-tick
 */
import { useEffect, useReducer } from 'react';

/**
 * @param {'inactive'|'fulfilled'|'calm'|'danger'|'urgent'|'last-hour'|'broken'} status
 */
export function useStreakTick(status) {
  const [, forceTick] = useReducer((x) => (x + 1) % 1000, 0);

  useEffect(() => {
    if (status === 'fulfilled' || status === 'inactive' || status === 'broken') {
      return undefined;
    }
    // last-hour necesita 1s para countdown MM:SS suave.
    // calm/danger/urgent solo necesitan detectar cruce horario (60s ok).
    const intervalMs = status === 'last-hour' ? 1000 : 60_000;
    const id = setInterval(forceTick, intervalMs);
    return () => clearInterval(id);
  }, [status]);
}
