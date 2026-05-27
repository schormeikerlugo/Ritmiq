import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuthStore } from '../../../stores/auth.js';
import { translateAuthError } from '../../../lib/errorMessages.js';
import {
  Button, TextField, FormError, FormSuccess,
} from '../../primitives/index.js';
import styles from './ForgotPasswordView.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Vista de recuperacion de contraseña.
 *
 * Pide email → llama supabase.auth.resetPasswordForEmail → muestra confirmacion.
 *
 * @param {{ onGoSignIn: () => void }} props
 */
export function ForgotPasswordView({ onGoSignIn }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [shake, setShake] = useState(false);
  const { resetPassword, clearError } = useAuthStore();
  const emailRef = useRef(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }, []);

  const onSubmit = useCallback(async (e) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!email.trim() || !EMAIL_RE.test(email.trim())) {
      setLocalError('Ingresa un correo válido.');
      emailRef.current?.focus();
      triggerShake();
      return;
    }

    setBusy(true);
    try {
      await resetPassword(email.trim());
      setSent(true);
    } catch (err) {
      // Por seguridad, mostramos siempre el mismo mensaje aunque el email
      // no exista (anti enumeracion). Solo error real si es de red/server.
      const msg = translateAuthError(err, { context: 'forgot' });
      // Si el error original era "user not found" el helper ya devolvio el
      // mensaje generico positivo, asi que mostramos como exito.
      if (/recibirás un enlace/i.test(msg)) {
        setSent(true);
      } else {
        setLocalError(msg);
        triggerShake();
      }
    } finally {
      setBusy(false);
    }
  }, [email, resetPassword, clearError, triggerShake]);

  if (sent) {
    return (
      <div className={styles.form}>
        <header className={styles.header}>
          <h1 className={styles.title}>Revisa tu correo</h1>
          <p className={styles.subtitle}>
            Si existe una cuenta con <strong>{email.trim()}</strong>, te
            enviamos un enlace para restablecer tu contraseña.
          </p>
        </header>

        <FormSuccess>
          El enlace caduca en 1 hora. Si no lo recibes, revisa tu carpeta de spam.
        </FormSuccess>

        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={onGoSignIn}
        >
          Volver a iniciar sesión
        </Button>

        <p className={styles.footer}>
          ¿No te llegó?{' '}
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => { setSent(false); setLocalError(null); }}
          >
            Intentar con otro correo
          </button>
        </p>
      </div>
    );
  }

  return (
    <form
      className={[styles.form, shake && styles.shake].filter(Boolean).join(' ')}
      onSubmit={onSubmit}
      noValidate
    >
      <header className={styles.header}>
        <h1 className={styles.title}>Recupera tu contraseña</h1>
        <p className={styles.subtitle}>
          Ingresa el correo de tu cuenta y te enviaremos un enlace para
          restablecerla.
        </p>
      </header>

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

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        loadingText="Enviando..."
      >
        Enviar enlace
      </Button>

      <p className={styles.footer}>
        <button type="button" className={styles.linkBtn} onClick={onGoSignIn} disabled={busy}>
          ← Volver a iniciar sesión
        </button>
      </p>
    </form>
  );
}
