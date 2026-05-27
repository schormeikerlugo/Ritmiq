import { Icon } from '../Icon/Icon.jsx';
import { Button } from './Button.jsx';
import styles from './EmptyState.module.css';

/**
 * Empty state reutilizable. Usar cuando una lista/grid/view no tiene
 * contenido para mostrar.
 *
 * @param {{
 *   icon?: string,             // nombre de Icon registrado (default: Music)
 *   iconSize?: number,         // default 40
 *   title: string,
 *   subtitle?: string,
 *   action?: { label: string, onClick: () => void, icon?: string, variant?: 'primary'|'ghost'|'subtle' },
 *   size?: 'sm' | 'md' | 'lg', // default 'md'
 *   className?: string,
 * }} props
 *
 * @example
 *   <EmptyState
 *     icon="Library"
 *     title="Tu biblioteca está vacía"
 *     subtitle="Busca canciones y guárdalas para escucharlas más tarde."
 *     action={{ label: 'Explorar', icon: 'Search', onClick: () => goSearch() }}
 *   />
 */
export function EmptyState({
  icon = 'Music',
  iconSize,
  title,
  subtitle,
  action,
  size = 'md',
  className,
}) {
  const effectiveIconSize = iconSize ?? (size === 'lg' ? 56 : size === 'sm' ? 28 : 40);
  return (
    <div className={[styles.empty, styles[`size_${size}`], className].filter(Boolean).join(' ')}>
      <div className={styles.iconWrap} aria-hidden="true">
        <Icon name={icon} size={effectiveIconSize} />
      </div>
      <h3 className={styles.title}>{title}</h3>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      {action && (
        <Button
          variant={action.variant ?? 'primary'}
          size={size === 'lg' ? 'lg' : 'md'}
          iconLeft={action.icon}
          onClick={action.onClick}
          className={styles.action}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
