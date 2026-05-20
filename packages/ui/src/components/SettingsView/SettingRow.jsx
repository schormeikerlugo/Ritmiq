/**
 * Fila de configuracion — label/descripcion a la izquierda + control a
 * la derecha. Si `nested` es true, el control salta debajo del label
 * (util para sliders, EQ grid, etc).
 *
 * @module @ritmiq/ui/components/SettingsView/SettingRow
 */
import styles from './SettingsView.module.css';

/**
 * @param {{
 *   label: string,
 *   description?: string,
 *   control?: React.ReactNode,
 *   nested?: boolean,
 *   onClick?: () => void,
 *   children?: React.ReactNode,
 * }} props
 */
export function SettingRow({ label, description, control, nested, onClick, children }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={styles.row}
      data-nested={nested || undefined}
      data-clickable={!!onClick || undefined}
      onClick={onClick}
    >
      <div className={styles.rowMain}>
        <div className={styles.rowLabel}>{label}</div>
        {description && <div className={styles.rowDesc}>{description}</div>}
        {nested && children && <div className={styles.rowNested}>{children}</div>}
      </div>
      {control && <div className={styles.rowControl}>{control}</div>}
    </Tag>
  );
}
