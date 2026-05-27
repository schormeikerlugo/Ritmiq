import { Icon } from '../Icon/Icon.jsx';
import styles from './FormBanner.module.css';

/**
 * Banner de error rojo para errores globales del formulario.
 * Acepta string o ReactNode como children.
 *
 * @param {{ children?: React.ReactNode, onDismiss?: () => void }} props
 */
export function FormError({ children, onDismiss }) {
  if (!children) return null;
  return (
    <div className={[styles.banner, styles.banner_error].join(' ')} role="alert">
      <Icon name="AlertCircle" size={16} />
      <span className={styles.text}>{children}</span>
      {onDismiss && (
        <button
          type="button"
          className={styles.dismiss}
          onClick={onDismiss}
          aria-label="Cerrar"
        >
          <Icon name="X" size={14} />
        </button>
      )}
    </div>
  );
}
