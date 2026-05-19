/**
 * Modal centrado y fijo en pantalla, con backdrop + bloqueo de scroll
 * del body. Reemplaza el patron repetido en SaveDialog, TrackInfoDialog,
 * SettingsDialog, etc.
 *
 * - Click en backdrop cierra (configurable con dismissOnBackdrop).
 * - Click dentro del dialogo no propaga (no cierra).
 * - ESC cierra (configurable).
 * - Bloqueo de body scroll mientras esta abierto (via useLockBodyScroll).
 * - Animacion: fade-in del backdrop + scale-in del dialog.
 * - Soporta size: 'sm' | 'md' | 'lg' | 'full' (mobile-friendly).
 *
 * Uso:
 *   <Modal onClose={() => setOpen(false)} title="Titulo" size="md">
 *     <p>Contenido</p>
 *   </Modal>
 *
 * @module @ritmiq/ui/components/Modal/Modal
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './Modal.module.css';

/**
 * @param {Object} props
 * @param {() => void} props.onClose
 * @param {React.ReactNode} props.children
 * @param {string} [props.title]
 * @param {'sm'|'md'|'lg'|'full'} [props.size='md']
 * @param {boolean} [props.dismissOnBackdrop=true]
 * @param {boolean} [props.dismissOnEscape=true]
 * @param {React.ReactNode} [props.footer]
 * @param {string} [props.className]
 */
export function Modal({
  onClose,
  children,
  title,
  size = 'md',
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  footer,
  className,
}) {
  useLockBodyScroll(true);

  useEffect(() => {
    if (!dismissOnEscape) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismissOnEscape, onClose]);

  const onBackdropClick = (e) => {
    if (e.target === e.currentTarget && dismissOnBackdrop) onClose?.();
  };

  const content = (
    <div
      className={styles.backdrop}
      onMouseDown={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`${styles.dialog} ${styles[`size_${size}`]} ${className ?? ''}`}>
        {title && (
          <header className={styles.header}>
            <h2 className={styles.title}>{title}</h2>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label="Cerrar"
            >
              <Icon name="X" size={18} />
            </button>
          </header>
        )}
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}
