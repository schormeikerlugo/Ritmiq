import { forwardRef, useId } from 'react';
import { Icon } from '../Icon/Icon.jsx';
import styles from './TextField.module.css';

/**
 * Campo de texto unificado: label + input + hint/error + iconos opcionales.
 *
 * @param {{
 *   label?: string,
 *   hint?: string,
 *   error?: string,
 *   success?: string,
 *   iconLeft?: string,
 *   iconRight?: string,
 *   suffix?: React.ReactNode,
 *   prefix?: React.ReactNode,
 *   variant?: 'default' | 'error' | 'success',
 *   id?: string,
 *   required?: boolean,
 *   optional?: boolean,
 *   onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void,
 * } & React.InputHTMLAttributes<HTMLInputElement>} props
 */
export const TextField = forwardRef(function TextField(
  {
    label,
    hint,
    error,
    success,
    iconLeft,
    iconRight,
    suffix,
    prefix,
    variant = 'default',
    id,
    required,
    optional,
    className,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;

  // Estado visual derivado: error > success > variant
  const effectiveVariant = error ? 'error' : success ? 'success' : variant;
  const message = error ?? success ?? hint;

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          <span>{label}</span>
          {optional && <span className={styles.optional}>opcional</span>}
        </label>
      )}
      <div
        className={[styles.inputWrap, styles[`variant_${effectiveVariant}`]].join(' ')}
        data-has-icon-left={iconLeft || prefix ? 'true' : undefined}
        data-has-icon-right={iconRight || suffix ? 'true' : undefined}
      >
        {iconLeft && (
          <span className={styles.iconLeft} aria-hidden="true">
            <Icon name={iconLeft} size={16} />
          </span>
        )}
        {prefix && <span className={styles.prefix}>{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          className={styles.input}
          required={required}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={message ? hintId : undefined}
          {...rest}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
        {iconRight && !suffix && (
          <span className={styles.iconRight} aria-hidden="true">
            <Icon name={iconRight} size={16} />
          </span>
        )}
      </div>
      {message && (
        <p
          id={hintId}
          className={[
            styles.hint,
            error && styles.hint_error,
            success && styles.hint_success,
          ].filter(Boolean).join(' ')}
          aria-live={error || success ? 'polite' : undefined}
        >
          {message}
        </p>
      )}
    </div>
  );
});
