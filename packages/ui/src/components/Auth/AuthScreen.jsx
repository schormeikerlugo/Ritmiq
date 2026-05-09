import { useState } from 'react';
import { useAuthStore } from '../../stores/auth.js';
import styles from './AuthScreen.module.css';

export function AuthScreen() {
  const [mode, setMode] = useState(/** @type {'signin'|'signup'} */ ('signin'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const { signIn, signUp, error, clearError } = useAuthStore();

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setInfo(null);
    clearError();
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        await signUp(email, password);
        setInfo('Cuenta creada. Inicia sesión.');
        setMode('signin');
      }
    } catch {
      /* error ya en store */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.brand}>Ritmiq</h1>
        <p className={styles.subtitle}>
          {mode === 'signin' ? 'Inicia sesión en tu biblioteca' : 'Crea tu cuenta'}
        </p>

        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.field}>
            <span className={styles.label}>Email</span>
            <input
              className={styles.input}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Contraseña</span>
            <input
              className={styles.input}
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}
          {info  && <p className={styles.info}>{info}</p>}

          <button className={styles.submit} type="submit" disabled={busy}>
            {busy ? '…' : mode === 'signin' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        <button
          className={styles.toggle}
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            clearError();
            setInfo(null);
          }}
        >
          {mode === 'signin'
            ? '¿No tienes cuenta? Regístrate'
            : '¿Ya tienes cuenta? Inicia sesión'}
        </button>
      </div>
    </div>
  );
}
