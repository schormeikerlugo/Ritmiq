/**
 * Segmented control — N opciones en una sola pill, una activa.
 * @module @ritmiq/ui/components/SettingsView/controls/SegmentedControl
 */
import styles from './controls.module.css';

/**
 * @param {{
 *   value: string,
 *   options: Array<{ id: string, label: string, icon?: React.ReactNode }>,
 *   onChange: (id: string) => void,
 *   ariaLabel?: string,
 * }} props
 */
export function SegmentedControl({ value, options, onChange, ariaLabel }) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={value === opt.id}
          data-active={value === opt.id}
          className={styles.segment}
          onClick={() => onChange(opt.id)}
        >
          {opt.icon}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
