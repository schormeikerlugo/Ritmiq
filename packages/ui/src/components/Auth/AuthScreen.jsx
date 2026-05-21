import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/auth.js';
import { supabase } from '../../lib/supabase.js';
import logotipoUrl from '../../assets/logotipo.png';
import styles from './AuthScreen.module.css';

const USERNAME_RE = /^[a-z0-9_]+$/;

export function AuthScreen() {
  const [mode, setMode] = useState(/** @type {'signin'|'signup'} */ ('signin'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [usernameStatus, setUsernameStatus] = useState('idle'); // idle|checking|available|taken|invalid
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const { signIn, signUp, error, clearError } = useAuthStore();
  const debounceRef = useRef(null);

  // Validacion live del username (solo en modo signup)
  useEffect(() => {
    if (mode !== 'signup' || !username) { setUsernameStatus('idle'); return; }
    clearTimeout(debounceRef.current);
    const next = username.trim().toLowerCase();
    if (next.length < 3 || next.length > 24 || !USERNAME_RE.test(next)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('username', next)
        .maybeSingle();
      setUsernameStatus(data ? 'taken' : 'available');
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [username, mode]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setInfo(null);
    clearError();
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        // Bloquear submit si el username no es valido / esta tomado.
        if (username && (usernameStatus === 'invalid' || usernameStatus === 'taken' || usernameStatus === 'checking')) {
          setBusy(false);
          return;
        }
        await signUp(email, password, { username, displayName });
        setInfo('Cuenta creada. Inicia sesión.');
        setMode('signin');
        setUsername('');
        setDisplayName('');
      }
    } catch {
      /* error ya en store */
    } finally {
      setBusy(false);
    }
  };

  const usernameHint = (() => {
    if (usernameStatus === 'invalid')   return { tone: 'err',  msg: '3-24 caracteres, solo a-z, 0-9 y _' };
    if (usernameStatus === 'checking')  return { tone: 'info', msg: 'Verificando...' };
    if (usernameStatus === 'taken')     return { tone: 'err',  msg: 'Ese @usuario ya esta tomado' };
    if (usernameStatus === 'available') return { tone: 'ok',   msg: 'Disponible' };
    return null;
  })();

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <img src={logotipoUrl} alt="Ritmiq" className={styles.brandLogo} />
        <p className={styles.subtitle}>
          {mode === 'signin' ? 'Inicia sesión en tu biblioteca' : 'Crea tu cuenta'}
        </p>

        <form className={styles.form} onSubmit={onSubmit}>
          {/* En signup pedimos primero los datos de identidad social */}
          {mode === 'signup' && (
            <>
              <label className={styles.field}>
                <span className={styles.label}>Nombre para mostrar</span>
                <input
                  className={styles.input}
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={busy}
                  maxLength={60}
                  placeholder="Como quieres que te llamen"
                />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Nombre de usuario</span>
                <div className={styles.usernameWrap}>
                  <span className={styles.usernamePrefix}>@</span>
                  <input
                    className={styles.usernameInput}
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    disabled={busy}
                    maxLength={24}
                    placeholder="tunombre"
                    spellCheck={false}
                  />
                </div>
                {usernameHint && (
                  <span className={styles.hint} data-tone={usernameHint.tone}>
                    {usernameHint.msg}
                  </span>
                )}
              </label>
            </>
          )}

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

          <button
            className={styles.submit}
            type="submit"
            disabled={
              busy
              || (mode === 'signup' && username
                  && (usernameStatus === 'invalid' || usernameStatus === 'taken' || usernameStatus === 'checking'))
            }
          >
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
