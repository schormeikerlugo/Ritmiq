/**
 * BottomSheet iOS-style para PWA mobile.
 *
 * Caracteristicas:
 *  - Sube desde abajo con animacion spring-like (cubic-bezier emphasized).
 *  - Header con "drag handle" gris arriba (visual cue para arrastrar).
 *  - Backdrop con dim oscuro detras + blur.
 *  - Click en backdrop cierra.
 *  - Swipe-down en el handle/body cierra (con resistencia visual).
 *  - Bloqueo de scroll del body mientras abierto (useLockBodyScroll).
 *  - Respeta safe-area-inset-bottom (iPhone home indicator).
 *  - Solo activo en mobile (<=768px). En desktop renderea como Modal centrado.
 *
 * Uso:
 *   <BottomSheet onClose={() => setOpen(false)} title="Opciones">
 *     <button>Opcion 1</button>
 *     <button>Opcion 2</button>
 *   </BottomSheet>
 *
 * @module @ritmiq/ui/components/BottomSheet/BottomSheet
 */
import { useEffect, useRef, useState } from 'react';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll.js';
import styles from './BottomSheet.module.css';

const CLOSE_THRESHOLD_PX = 80; // distancia para gatillar cierre por swipe
const CLOSE_VELOCITY_PX_PER_MS = 0.5; // velocidad alternativa

/**
 * @param {Object} props
 * @param {() => void} props.onClose
 * @param {React.ReactNode} props.children
 * @param {string} [props.title]
 * @param {React.ReactNode} [props.header] Override custom del header (icono + texto).
 * @param {boolean} [props.dismissOnBackdrop=true]
 */
export function BottomSheet({ onClose, children, title, header, dismissOnBackdrop = true }) {
  useLockBodyScroll(true);

  const sheetRef = useRef(null);
  const [closing, setClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef({
    startY: 0,
    lastY: 0,
    lastT: 0,
    velocity: 0,
    active: false,
  });

  // ESC cierra (desktop / teclado).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    // Esperamos a que la animacion de salida termine antes de unmount.
    setTimeout(() => onClose?.(), 260);
  };

  // ── Swipe-down handlers ──────────────────────────────────────────────
  const onTouchStart = (e) => {
    const t = e.touches[0];
    if (!t) return;
    dragRef.current = {
      startY: t.clientY,
      lastY: t.clientY,
      lastT: performance.now(),
      velocity: 0,
      active: true,
    };
  };

  const onTouchMove = (e) => {
    if (!dragRef.current.active) return;
    const t = e.touches[0];
    if (!t) return;
    const now = performance.now();
    const dy = Math.max(0, t.clientY - dragRef.current.startY);
    // Calculo de velocidad para usar como criterio alternativo de cierre.
    const dt = now - dragRef.current.lastT;
    if (dt > 0) {
      dragRef.current.velocity = (t.clientY - dragRef.current.lastY) / dt;
    }
    dragRef.current.lastY = t.clientY;
    dragRef.current.lastT = now;
    // Aplicamos la translacion con un poco de resistencia para que se
    // sienta "elastica" — el sheet no sigue al dedo 1:1, sino con un
    // factor 0.92 (90% del movimiento). Se siente mas refinado.
    setDragY(dy * 0.92);
  };

  const onTouchEnd = () => {
    if (!dragRef.current.active) return;
    const finalY = dragY / 0.92; // delta real
    const v = dragRef.current.velocity;
    dragRef.current.active = false;
    if (finalY > CLOSE_THRESHOLD_PX || v > CLOSE_VELOCITY_PX_PER_MS) {
      handleClose();
    } else {
      // Snap-back animado a posicion 0.
      setDragY(0);
    }
  };

  const onBackdropMouseDown = (e) => {
    if (e.target === e.currentTarget && dismissOnBackdrop) handleClose();
  };

  // Compute transform: durante drag, translateY = dragY. Durante closing
  // animation, dejamos que el CSS @keyframes maneje el slide-down.
  const sheetStyle = !closing && dragY > 0
    ? {
        transform: `translateY(${dragY}px)`,
        transition: 'none',
      }
    : !closing && dragY === 0
      ? { transition: 'transform 260ms var(--ease-emphasized)' }
      : undefined;

  return (
    <div
      className={styles.backdrop}
      data-closing={closing}
      onMouseDown={onBackdropMouseDown}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={sheetRef}
        className={styles.sheet}
        data-closing={closing}
        style={sheetStyle}
      >
        {/* Handle drag — area touch sensible para swipe-down */}
        <div
          className={styles.handleWrap}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className={styles.handle} aria-hidden="true" />
        </div>

        {(title || header) && (
          <header
            className={styles.header}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {header ?? <h3 className={styles.title}>{title}</h3>}
          </header>
        )}

        <div className={styles.body}>
          {children}
        </div>
      </div>
    </div>
  );
}
