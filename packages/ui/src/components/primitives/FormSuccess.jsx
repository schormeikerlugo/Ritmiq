import { Icon } from '../Icon/Icon.jsx';
import styles from './FormBanner.module.css';

/**
 * Banner de exito verde para mensajes positivos del formulario.
 *
 * @param {{ children?: React.ReactNode, onDismiss?: () => void }} props
 */
export function FormSuccess({ children, onDismiss }) {
  if (!children) return null;
  return (
    <div className={[styles.banner, styles.banner_success].join(' ')} role="status">
      <Icon name="CheckCircle2" size={16} />
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
