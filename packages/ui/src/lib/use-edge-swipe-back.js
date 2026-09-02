/**
 * useEdgeSwipeBack — gesto "deslizar desde el borde izquierdo para volver".
 *
 * Replica el gesto nativo de iOS/Android en la PWA: un swipe que empieza en el
 * borde IZQUIERDO de la pantalla y arrastra hacia la derecha ejecuta una acción
 * de "atrás". Sólo en móvil (touch): en desktop no aplica.
 *
 * Diseño para NO colisionar con el contenido:
 *   - Sólo arranca si el `touchstart` cae en una franja estrecha del borde
 *     izquierdo (EDGE_ZONE px). Ahí no hay carruseles ni drag horizontal, así
 *     que no interfiere con scroll-x (Home rows) ni con dnd-kit (reordenar).
 *   - Sólo cuenta como "atrás" un arrastre predominantemente horizontal
 *     (dx > dy) que supere un umbral, con velocidad/gesto claro.
 *   - Feedback visual opcional: mientras el dedo arrastra, el shell se desplaza
 *     con `translateX` (via callback onProgress); al soltar, se completa o
 *     revierte.
 *
 * La acción "atrás" es JERÁRQUICA (la provee el caller vía `onBack`):
 * normalmente cierra overlays abiertos (NowPlaying, cola, sidebar) y, si no hay
 * ninguno, hace goBack() en el historial de vistas.
 *
 * @param {{
 *   enabled?: boolean,
 *   onBack: () => void,
 *   canGoBack?: () => boolean,   // si devuelve false, no se arma el gesto
 *   onProgress?: (px: number) => void,  // desplazamiento en curso (0..ancho)
 *   onEnd?: () => void,          // se llamó soltar (para resetear el visual)
 * }} opts
 */
import { useEffect, useRef } from 'react';

const EDGE_ZONE = 24;          // px desde el borde izquierdo donde arranca
const TRIGGER_RATIO = 0.32;    // fracción del ancho que confirma el "atrás"
const TRIGGER_MIN_PX = 70;     // mínimo absoluto para confirmar
const HORIZONTAL_BIAS = 1.4;   // dx debe superar dy * este factor
const MAX_DRAG = 0.9;          // límite visual del arrastre (fracción ancho)

export function useEdgeSwipeBack({ enabled = true, onBack, canGoBack, onProgress, onEnd }) {
  const state = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    // Sólo dispositivos táctiles.
    const isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
    if (!isTouch) return;

    const width = () => window.innerWidth || document.documentElement.clientWidth || 1;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      // Arranca sólo desde la franja del borde izquierdo.
      if (t.clientX > EDGE_ZONE) return;
      // Si el caller dice que no hay a dónde volver, no armar el gesto.
      if (typeof canGoBack === 'function' && !canGoBack()) return;
      state.current = {
        x0: t.clientX,
        y0: t.clientY,
        active: false,   // se vuelve true cuando confirmamos que es horizontal
        dx: 0,
      };
    };

    const onTouchMove = (e) => {
      const s = state.current;
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x0;
      const dy = t.clientY - s.y0;
      s.dx = dx;

      // Aún no decidido: determinar si el gesto es horizontal-hacia-la-derecha.
      if (!s.active) {
        // Movimiento demasiado pequeño: esperar.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        // Si es más vertical que horizontal, o va hacia la izquierda, abortar
        // (es un scroll normal, no un back-swipe).
        if (dx <= 0 || Math.abs(dx) < Math.abs(dy) * HORIZONTAL_BIAS) {
          state.current = null;
          return;
        }
        s.active = true;
      }

      // Gesto horizontal confirmado: prevenir el scroll y mover el shell.
      if (e.cancelable) e.preventDefault();
      const clamped = Math.max(0, Math.min(dx, width() * MAX_DRAG));
      onProgress?.(clamped);
    };

    const finish = () => {
      const s = state.current;
      state.current = null;
      if (!s) return;
      const confirmed = s.active &&
        s.dx >= Math.max(TRIGGER_MIN_PX, width() * TRIGGER_RATIO);
      onEnd?.();
      if (confirmed) onBack?.();
    };

    const onTouchEnd = () => finish();
    const onTouchCancel = () => { const had = state.current; state.current = null; if (had) onEnd?.(); };

    // passive:false en move para poder preventDefault el scroll durante el drag.
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [enabled, onBack, canGoBack, onProgress, onEnd]);
}
