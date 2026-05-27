import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuthStore } from '../../../stores/auth.js';
import { translateAuthError } from '../../../lib/errorMessages.js';
import { isPasswordAcceptable } from '../../../lib/passwordStrength.js';
import {
  Button, PasswordField, FormError, FormSuccess,
} from '../../primitives/index.js';
import { AuthHero } from '../AuthHero.jsx';
import { AuthCard } from '../AuthCard.jsx';
import styles from './ResetPasswordView.module.css';

/**
 * Vista que se renderiza como pantalla completa cuando el user pulsa el link
 * del email de recovery. App.jsx detecta el hash `#reset-password` o el query
 * `?type=recovery&access_token=...` y renderiza este componente en lugar de
 * AuthScreen / shell normal.
 *
 * Al exito redirige a "/" limpio.
 */
export function ResetPasswordView() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [shake, setShake] = useState(false);
  const { updatePassword, signOut } = useAuthStore();
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  );
  const passRef = useRef(null);

  useEffect(() => {
    passRef.current?.focus();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }, []);

  const goHome = useCallback(async () => {
    // Cerramos la sesion temporal de recovery y limpiamos el hash
    try { await signOut(); } catch { /* ignore */ }
    if (typeof window !== 'undefined') {
      window.location.hash = '';
      window.location.replace('/');
    }
  }, [signOut]);

  const onSubmit = useCallback(async (e) => {
    e.preventDefault();
    setLocalError(null);

    if (!isPasswordAcceptable(password)) {
      setLocalError('Tu contraseña es demasiado débil. Usa al menos 8 caracteres.');
      triggerShake();
      return;
    }
    if (password !== confirm) {
      setLocalError('Las contraseñas no coinciden.');
      triggerShake();
      return;
    }

    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
      setTimeout(() => { goHome(); }, 1800);
    } catch (err) {
      setLocalError(translateAuthError(err, { context: 'reset' }));
      triggerShake();
    } finally {
      setBusy(false);
    }
  }, [password, confirm, updatePassword, goHome, triggerShake]);

  return (
    <div className={styles.screen}>
      <div className={styles.heroPane}>
        <AuthHero compact={isMobile} />
      </div>
      <div className={styles.cardPane}>
        <AuthCard mode="reset">
          {done ? (
            <div className={styles.form}>
              <header className={styles.header}>
                <h1 className={styles.title}>¡Listo!</h1>
                <p className={styles.subtitle}>
                  Tu contraseña se actualizó correctamente.
                </p>
              </header>
              <FormSuccess>Te llevamos a iniciar sesión...</FormSuccess>
              <Button variant="primary" size="lg" fullWidth onClick={goHome}>
                Continuar
              </Button>
            </div>
          ) : (
            <form
              className={[styles.form, shake && styles.shake].filter(Boolean).join(' ')}
              onSubmit={onSubmit}
              noValidate
            >
              <header className={styles.header}>
                <h1 className={styles.title}>Nueva contraseña</h1>
                <p className={styles.subtitle}>
                  Elige una contraseña que recuerdes y guárdala bien.
                </p>
              </header>

              <FormError onDismiss={() => setLocalError(null)}>{localError}</FormError>

              <PasswordField
                ref={passRef}
                label="Nueva contraseña"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
                minLength={8}
                showStrength
                strengthHint
              />

              <PasswordField
                label="Confirmar contraseña"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
                required
                minLength={8}
                error={confirm && confirm !== password ? 'No coincide' : undefined}
                success={confirm && confirm === password && password ? 'Coincide' : undefined}
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={busy}
                loadingText="Actualizando..."
                disabled={!isPasswordAcceptable(password) || password !== confirm}
              >
                Actualizar contraseña
              </Button>
            </form>
          )}
        </AuthCard>
      </div>
    </div>
  );
}
