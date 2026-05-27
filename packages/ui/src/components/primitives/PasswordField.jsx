import { forwardRef, useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '../Icon/Icon.jsx';
import { TextField } from './TextField.jsx';
import { PasswordStrengthMeter } from './PasswordStrengthMeter.jsx';
import styles from './PasswordField.module.css';

/**
 * Campo de contraseña con:
 *   - Toggle reveal (Eye/EyeOff)
 *   - Caps Lock warning live
 *   - Strength meter opcional (showStrength)
 *
 * @param {{
 *   label?: string,
 *   value?: string,
 *   showStrength?: boolean,
 *   strengthHint?: boolean, // muestra sugerencias debajo de la barra
 *   autoComplete?: 'current-password' | 'new-password',
 * } & React.InputHTMLAttributes<HTMLInputElement>} props
 */
export const PasswordField = forwardRef(function PasswordField(
  {
    label = 'Contraseña',
    value,
    onChange,
    onKeyDown,
    onBlur,
    onFocus,
    showStrength = false,
    strengthHint = false,
    autoComplete = 'current-password',
    iconLeft = 'Lock',
    error,
    hint,
    success,
    ...rest
  },
  ref,
) {
  const [reveal, setReveal] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [focused, setFocused] = useState(false);
  const innerRef = useRef(null);

  const setRefs = useCallback((node) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const handleKeyDown = useCallback((e) => {
    if (typeof e.getModifierState === 'function') {
      setCapsOn(e.getModifierState('CapsLock'));
    }
    onKeyDown?.(e);
  }, [onKeyDown]);

  // Re-evaluar caps al hacer focus por si ya esta activado antes de tipear
  const handleFocus = useCallback((e) => {
    setFocused(true);
    onFocus?.(e);
  }, [onFocus]);

  const handleBlur = useCallback((e) => {
    setFocused(false);
    onBlur?.(e);
  }, [onBlur]);

  useEffect(() => {
    if (!focused) setCapsOn(false);
  }, [focused]);

  const toggleReveal = useCallback(() => setReveal((r) => !r), []);

  const suffix = (
    <button
      type="button"
      className={styles.revealBtn}
      onClick={toggleReveal}
      aria-label={reveal ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      tabIndex={-1}
    >
      <Icon name={reveal ? 'EyeOff' : 'Eye'} size={16} />
    </button>
  );

  // Hint combinado: caps lock tiene prioridad
  const combinedHint = capsOn ? 'Mayúsculas activadas' : hint;

  return (
    <div className={styles.wrap}>
      <TextField
        ref={setRefs}
        label={label}
        type={reveal ? 'text' : 'password'}
        autoComplete={autoComplete}
        iconLeft={iconLeft}
        suffix={suffix}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        hint={combinedHint}
        error={error}
        success={success}
        {...rest}
      />
      {showStrength && (value ?? '').length > 0 && (
        <PasswordStrengthMeter value={value} showHint={strengthHint} />
      )}
    </div>
  );
});
