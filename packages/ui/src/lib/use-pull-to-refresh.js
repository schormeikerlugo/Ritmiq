/**
 * Pull-to-refresh para PWA mobile.
 *
 * Uso:
 *   const { bind, pullDistance, refreshing } = usePullToRefresh({
 *     onRefresh: async () => { await loadStuff(); },
 *   });
 *   return <div {...bind} style={{ transform: `translateY(${pullDistance}px)` }}>...</div>;
 *
 * - Solo activo en mobile (max-width 768px); en desktop bind devuelve {}.
 * - Solo dispara si el scroll del contenedor esta en el TOP (scrollTop===0).
 * - Threshold: 70px de pull para confirmar el refresh.
 * - Damping: el pull se siente con resistencia (sqrt) — no es 1:1.
 *
 * @module @ritmiq/ui/lib/use-pull-to-refresh
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const PULL_THRESHOLD = 70;          // px para disparar refresh
const MAX_PULL = 140;               // tope visual con damping

/**
 * @param {{ onRefresh: () => (void | Promise<void>), disabled?: boolean }} opts
 */
export function usePullToRefresh({ onRefresh, disabled = false }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(null);
  const triggeredRef = useRef(false);
  const isMobile = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    isMobile.current = mq.matches;
    const handler = (e) => { isMobile.current = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Busca el ancestro scrolleable mas cercano a partir de un elemento.
  // Necesario porque el contenedor con overflow puede no ser el mismo
  // que recibe el touch event (en Ritmiq el scroll vive en `.main` del
  // App shell, no en el `.wrap` de cada vista).
  const findScrollParent = (el) => {
    let node = el;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      const oy = style.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };

  const onTouchStart = useCallback((e) => {
    if (disabled || !isMobile.current || refreshing) return;
    // Encuentra el contenedor scrolleable real (puede ser un ancestro).
    const scrollEl = findScrollParent(e.currentTarget);
    if (scrollEl && scrollEl.scrollTop > 0) return;
    startYRef.current = e.touches[0].clientY;
    triggeredRef.current = false;
  }, [disabled, refreshing]);

  const onTouchMove = useCallback((e) => {
    if (startYRef.current == null) return;
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy <= 0) {
      setPullDistance(0);
      return;
    }
    // Damping: sqrt-based, suaviza el avance conforme se estira.
    const damped = Math.min(MAX_PULL, Math.sqrt(dy) * 8);
    setPullDistance(damped);
  }, []);

  const onTouchEnd = useCallback(async () => {
    if (startYRef.current == null) return;
    const reached = pullDistance >= PULL_THRESHOLD;
    startYRef.current = null;
    if (reached && !triggeredRef.current) {
      triggeredRef.current = true;
      setRefreshing(true);
      // Mantener el indicador visible mientras refresca.
      setPullDistance(PULL_THRESHOLD);
      try {
        await onRefresh();
      } catch {}
      finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, onRefresh]);

  // Si esta deshabilitado o no es mobile, no devolver handlers — la
  // ausencia evita cualquier overhead en desktop.
  if (disabled || !isMobile.current) {
    return { bind: {}, pullDistance: 0, refreshing: false };
  }
  return {
    bind: { onTouchStart, onTouchMove, onTouchEnd },
    pullDistance,
    refreshing,
  };
}
