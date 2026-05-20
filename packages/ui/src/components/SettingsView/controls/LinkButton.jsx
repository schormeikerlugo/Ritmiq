/**
 * LinkButton — boton tipo "Editar →" o "Ver más →" en la fila de un
 * SettingRow. Aspecto plano con icono opcional + chevron.
 *
 * @module @ritmiq/ui/components/SettingsView/controls/LinkButton
 */
import { Icon } from '../../Icon/Icon.jsx';
import styles from './controls.module.css';

/**
 * @param {{
 *   children: React.ReactNode,
 *   onClick?: () => void,
 *   href?: string,
 *   external?: boolean,
 *   variant?: 'default' | 'danger',
 * }} props
 */
export function LinkButton({ children, onClick, href, external, variant = 'default' }) {
  const className = `${styles.linkBtn} ${variant === 'danger' ? styles.linkBtnDanger : ''}`;
  if (href) {
    return (
      <a
        className={className}
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
      >
        <span>{children}</span>
        <Icon name={external ? 'Share2' : 'ChevronRight'} size={14} />
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      <span>{children}</span>
      <Icon name="ChevronRight" size={14} />
    </button>
  );
}
