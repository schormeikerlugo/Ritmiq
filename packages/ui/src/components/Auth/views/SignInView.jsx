import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuthStore } from '../../../stores/auth.js';
import { translateAuthError } from '../../../lib/errorMessages.js';
import {
  Button, TextField, PasswordField, FormError, FormSuccess,
} from '../../primitives/index.js';
import styles from './SignInView.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Vista de inicio de sesion.
 *
 * @param {{ onGoSignUp: () => void, onGoForgot: () => void, initialInfo?: string }} props
 */
export function SignInView({ onGoSignUp, onGoForgot, initialInfo }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [info, setInfo] = useState(initialInfo ?? null);
  const [shake, setShake] = useState(false);
  const { signIn, clearError } = useAuthStore();
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  // Auto focus al montar
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }, []);

  const validate = useCallback(() => {
    if (!email.trim()) {
      setLocalError('Ingresa tu correo.');
      emailRef.current?.focus();
      triggerShake();
      return false;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setLocalError('El correo no tiene un formato válido.');
      emailRef.current?.focus();
      triggerShake();
      return false;
    }
    if (!password) {
      setLocalError('Ingresa tu contraseña.');
      passwordRef.current?.focus();
      triggerShake();
      return false;
    }
    return true;
  }, [email, password, triggerShake]);

  const onSubmit = useCallback(async (e) => {
    e.preventDefault();
    setLocalError(null);
    setInfo(null);
    clearError();
    if (!validate()) return;

    setBusy(true);
    try {
      await signIn(email.trim(), password);
      // Si llega aqui, App.jsx se desmonta al ver el user en store
    } catch (err) {
      setLocalError(translateAuthError(err, { context: 'signin' }));
      triggerShake();
    } finally {
      setBusy(false);
    }
  }, [email, password, signIn, clearError, validate, triggerShake]);

  return (
    <form
      className={[styles.form, shake && styles.shake].filter(Boolean).join(' ')}
      onSubmit={onSubmit}
      noValidate
    >
      <header className={styles.header}>
        <h1 className={styles.title}>Bienvenido de vuelta</h1>
        <p className={styles.subtitle}>Inicia sesión para seguir escuchando.</p>
      </header>

      <FormSuccess onDismiss={() => setInfo(null)}>{info}</FormSuccess>
      <FormError onDismiss={() => setLocalError(null)}>{localError}</FormError>

      <TextField
        ref={emailRef}
        label="Correo electrónico"
        type="email"
        autoComplete="email"
        inputMode="email"
        iconLeft="Mail"
        placeholder="tu@correo.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={busy}
        required
      />

      <PasswordField
        ref={passwordRef}
        label="Contraseña"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
        required
      />

      <div className={styles.forgotRow}>
        <button
          type="button"
          className={styles.linkBtn}
          onClick={onGoForgot}
          disabled={busy}
        >
          ¿Olvidaste tu contraseña?
        </button>
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        loadingText="Entrando..."
      >
        Entrar
      </Button>

      <p className={styles.footer}>
        ¿No tienes cuenta?{' '}
        <button type="button" className={styles.linkBtn} onClick={onGoSignUp} disabled={busy}>
          Crear una
        </button>
      </p>
    </form>
  );
}
