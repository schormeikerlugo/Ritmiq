import { createPortal } from 'react-dom';
import { useToastStore } from '../../stores/toast.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './ToastHost.module.css';

/**
 * Renderiza los toasts del store en un portal al body.
 * Se monta una sola vez en App.jsx (al pie del shell).
 *
 * Posicion: bottom-center (mobile) / bottom-right (desktop) con stacking
 * vertical. Cada toast tiene su propio fade-in + slide-up al aparecer y
 * fade-out + slide-down al desaparecer.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.host} role="region" aria-label="Notificaciones" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[styles.toast, styles[`variant_${t.variant}`]].join(' ')}
          role={t.variant === 'error' ? 'alert' : 'status'}
        >
          {t.icon && (
            <span className={styles.icon} aria-hidden="true">
              <Icon name={t.icon} size={16} />
            </span>
          )}
          <span className={styles.message}>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className={styles.action}
              onClick={() => { t.action.onClick(); dismiss(t.id); }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => dismiss(t.id)}
            aria-label="Cerrar"
          >
            <Icon name="X" size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
