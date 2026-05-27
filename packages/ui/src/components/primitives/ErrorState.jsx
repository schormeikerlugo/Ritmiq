import { Icon } from '../Icon/Icon.jsx';
import { Button } from './Button.jsx';
import styles from './ErrorState.module.css';

/**
 * Estado de error reutilizable con accion de retry. Hermano de
 * <EmptyState> pero orientado a errores (icono rojo, retry default).
 *
 * @param {{
 *   icon?: string,             // default 'AlertTriangle'
 *   title?: string,            // default 'Algo salió mal'
 *   message?: string,          // mensaje detallado del error
 *   onRetry?: () => void | Promise<void>,
 *   retryLabel?: string,       // default 'Reintentar'
 *   compact?: boolean,         // version inline para banners de seccion
 *   className?: string,
 * }} props
 *
 * @example
 *   <ErrorState
 *     message={error.message}
 *     onRetry={loadData}
 *   />
 */
export function ErrorState({
  icon = 'AlertTriangle',
  title = 'Algo salió mal',
  message,
  onRetry,
  retryLabel = 'Reintentar',
  compact = false,
  className,
}) {
  if (compact) {
    return (
      <div className={[styles.compact, className].filter(Boolean).join(' ')} role="alert">
        <Icon name={icon} size="sm" className={styles.compactIcon} />
        <span className={styles.compactMsg}>{message ?? title}</span>
        {onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry} iconLeft="ArrowDownToLine">
            {retryLabel}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={[styles.full, className].filter(Boolean).join(' ')} role="alert">
      <div className={styles.iconWrap} aria-hidden="true">
        <Icon name={icon} size="2xl" />
      </div>
      <h3 className={styles.title}>{title}</h3>
      {message && <p className={styles.message}>{message}</p>}
      {onRetry && (
        <Button variant="primary" size="md" onClick={onRetry} className={styles.retry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
