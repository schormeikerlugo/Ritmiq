/**
 * Slider horizontal con valor en vivo a la derecha.
 * @module @ritmiq/ui/components/SettingsView/controls/Slider
 */
import styles from './controls.module.css';

/**
 * @param {{
 *   value: number, min: number, max: number, step?: number,
 *   onChange: (v: number) => void,
 *   format?: (v: number) => string,
 *   ariaLabel?: string,
 *   disabled?: boolean,
 * }} props
 */
export function Slider({ value, min, max, step = 1, onChange, format, ariaLabel, disabled }) {
  return (
    <div className={styles.sliderWrap}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={styles.slider}
        aria-label={ariaLabel}
      />
      <span className={styles.sliderVal}>
        {format ? format(value) : value}
      </span>
    </div>
  );
}
