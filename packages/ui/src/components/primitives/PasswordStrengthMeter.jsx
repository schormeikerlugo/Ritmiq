import { useMemo } from 'react';
import { scorePassword } from '../../lib/passwordStrength.js';
import styles from './PasswordStrengthMeter.module.css';

/**
 * Barra de 4 segmentos que indica la fortaleza de la contraseña.
 *
 * @param {{ value?: string, showHint?: boolean }} props
 */
export function PasswordStrengthMeter({ value, showHint = false }) {
  const { score, label, suggestions } = useMemo(() => scorePassword(value), [value]);

  const SEGMENTS = 4;

  return (
    <div className={styles.wrap} aria-live="polite">
      <div className={styles.bars} data-score={score}>
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <span
            key={i}
            className={[styles.bar, i <= score && styles.barActive].filter(Boolean).join(' ')}
          />
        ))}
      </div>
      <span className={styles.label} data-score={score}>{label}</span>
      {showHint && suggestions.length > 0 && (
        <ul className={styles.suggestions}>
          {suggestions.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
    </div>
  );
}
