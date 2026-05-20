/**
 * Toggle pill — verde/gris, estilo Spotify.
 * @module @ritmiq/ui/components/SettingsView/controls/Toggle
 */
import styles from './controls.module.css';

/** @param {{ checked: boolean, onChange: (next:boolean) => void, disabled?: boolean, ariaLabel?: string }} props */
export function Toggle({ checked, onChange, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-on={checked}
      disabled={disabled}
      className={styles.toggle}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleDot} />
    </button>
  );
}
