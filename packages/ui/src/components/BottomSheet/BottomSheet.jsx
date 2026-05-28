/**
 * BottomSheet iOS-style — modal bottom-up con drag-to-dismiss para PWA
 * mobile, modal centrado clasico en desktop.
 *
 * Caracteristicas:
 *  - Sube desde abajo con animacion spring (cubic-bezier emphasized).
 *  - Drag handle arriba como cue visual para arrastrar.
 *  - Backdrop con dim oscuro + blur. Click cierra.
 *  - Drag-to-dismiss via Pointer Events (touch + mouse unificado) en el
 *    handle Y el header. Threshold por porcentaje del alto del sheet
 *    (35%) o por velocidad (0.5 px/ms hacia abajo) para sentir natural
 *    en cualquier tamano de viewport.
 *  - Resistencia elastica (factor 0.92) para que el drag se sienta
 *    refinado en lugar de seguir 1:1 al dedo.
 *  - Backdrop dim dinamico durante el drag (mas opaco -> mas cerca).
 *  - Bloquea scroll del body mientras esta abierto.
 *  - Respeta safe-area-inset-bottom (iPhone home indicator) via CSS.
 *  - Solo activo en mobile (<=768px). En desktop renderea como Modal.
 *
 * Renderizado INLINE — no portalea. La via estandar es usar el store
 * global `useBottomSheet` + `<BottomSheetHost />` (montado una vez en
 * App.jsx). Ver bottom-sheet.js y BottomSheetHost.jsx.
 *
 * @module @ritmiq/ui/components/BottomSheet/BottomSheet
 */
import { useEffect, useRef, useState } from 'react';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll.js';
import styles from './BottomSheet.module.css';

const CLOSE_THRESHOLD_PCT = 0.35;        // 35% del alto del sheet
const CLOSE_VELOCITY_PX_PER_MS = 0.5;    // velocidad alternativa
const DRAG_RESISTANCE = 0.92;            // factor de seguimiento

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
  // Estado del drag actual. Mantener en ref evita re-renders por frame.
  const dragRef = useRef({
    pointerId: null,
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

  // ── Pointer events (touch + mouse unificados) ────────────────────────
  // pointerdown: registra inicio + captura el pointer al elemento para
  // que pointermove y pointerup nos lleguen aunque el cursor salga.
  // pointermove: actualiza translateY con resistencia 0.92.
  // pointerup: decide cierre vs snap-back con threshold + velocidad.

  const onPointerDown = (e) => {
    // Solo botton primario o touch/pen. Ignoramos right-click, etc.
    if (e.button !== undefined && e.button !== 0) return;
    const target = e.currentTarget;
    try { target.setPointerCapture?.(e.pointerId); } catch {}
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      lastT: performance.now(),
      velocity: 0,
      active: true,
    };
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    const now = performance.now();
    const dy = Math.max(0, e.clientY - d.startY);
    const dt = now - d.lastT;
    if (dt > 0) d.velocity = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = now;
    setDragY(dy * DRAG_RESISTANCE);
  };

  const onPointerUp = (e) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    const target = e.currentTarget;
    try { target.releasePointerCapture?.(e.pointerId); } catch {}
    const finalY = dragY / DRAG_RESISTANCE; // delta real arrastrado
    const v = d.velocity;
    d.active = false;
    d.pointerId = null;

    // Threshold: 35% del alto del sheet (medido en runtime).
    const sheetH = sheetRef.current?.offsetHeight ?? 600;
    const closeThresholdPx = sheetH * CLOSE_THRESHOLD_PCT;

    if (finalY > closeThresholdPx || v > CLOSE_VELOCITY_PX_PER_MS) {
      handleClose();
    } else {
      // Snap-back animado a posicion 0.
      setDragY(0);
    }
  };

  const onPointerCancel = (e) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    d.active = false;
    d.pointerId = null;
    setDragY(0);
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

  // Backdrop dim dinamico durante drag. Cuanto mas se arrastra hacia
  // abajo, mas transparente se vuelve \u2014 cue visual de "estas cerrando".
  // Usamos el alto del sheet como referencia: opacidad cae linealmente
  // entre 0 (sin drag) y 50% del threshold de cierre.
  const sheetH = sheetRef.current?.offsetHeight ?? 600;
  const closeThresholdPx = sheetH * CLOSE_THRESHOLD_PCT;
  const realDragY = dragY / DRAG_RESISTANCE;
  const dragProgress = Math.min(1, realDragY / closeThresholdPx);
  const backdropStyle = !closing && dragY > 0
    ? { opacity: 1 - dragProgress * 0.6, transition: 'none' }
    : undefined;

  // Drag handlers comunes para el handle Y el header (mas area de
  // captura, mejor UX en mobile).
  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };

  return (
    <>
      <div
        className={styles.backdrop}
        data-closing={closing}
        style={backdropStyle}
        onMouseDown={onBackdropMouseDown}
        aria-hidden="true"
      />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div
          ref={sheetRef}
          className={styles.sheetInner}
          data-closing={closing}
          data-dragging={dragY > 0 && !closing ? 'true' : undefined}
          style={sheetStyle}
        >
          {/* Handle drag — area touch sensible para swipe-down */}
          <div className={styles.handleWrap} {...dragHandlers}>
            <div className={styles.handle} aria-hidden="true" />
          </div>

          {(title || header) && (
            <header className={styles.header} {...dragHandlers}>
              {header ?? <h3 className={styles.title}>{title}</h3>}
            </header>
          )}

          <div className={styles.body}>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
