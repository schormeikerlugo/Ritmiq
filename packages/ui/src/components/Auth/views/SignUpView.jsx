import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuthStore } from '../../../stores/auth.js';
import { supabase } from '../../../lib/supabase.js';
import { translateAuthError } from '../../../lib/errorMessages.js';
import { isPasswordAcceptable } from '../../../lib/passwordStrength.js';
import { suggestUsernameFromEmail } from '../../../lib/usernameSuggest.js';
import {
  Button, TextField, PasswordField, FormError, FormSuccess,
} from '../../primitives/index.js';
import { Icon } from '../../Icon/Icon.jsx';
import styles from './SignUpView.module.css';

const USERNAME_RE = /^[a-z0-9_]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Vista de creacion de cuenta.
 *
 *   - Username OBLIGATORIO con auto-sugerencia al hacer blur del email.
 *   - Validacion live del username (regex + disponibilidad via Supabase).
 *   - Password strength meter en vivo.
 *   - DisplayName opcional.
 *
 * @param {{ onGoSignIn: () => void }} props
 */
export function SignUpView({ onGoSignIn }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [userEdited, setUserEdited] = useState(false); // ¿user edito a mano el username?
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [info, setInfo] = useState(null);
  const [shake, setShake] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState(/** @type {'idle'|'invalid'|'checking'|'available'|'taken'|'error'} */('idle'));
  const { signUp, clearError } = useAuthStore();
  const debounceRef = useRef(null);
  const nameRef = useRef(null);
  const emailRef = useRef(null);
  const userRef = useRef(null);
  const passRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Cuando el user pierde focus del email, auto-rellena username SI no fue
  // editado a mano todavia.
  const handleEmailBlur = useCallback(() => {
    if (userEdited) return;
    if (!email.trim() || !EMAIL_RE.test(email.trim())) return;
    const sugg = suggestUsernameFromEmail(email);
    if (sugg && sugg !== username) {
      setUsername(sugg);
    }
  }, [email, username, userEdited]);

  const handleUsernameChange = useCallback((e) => {
    setUserEdited(true);
    const v = e.target.value.toLowerCase().slice(0, 24);
    setUsername(v);
  }, []);

  // Live validation del username
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const next = username.trim().toLowerCase();
    if (!next) {
      setUsernameStatus('idle');
      return;
    }
    if (next.length < 3 || next.length > 24 || !USERNAME_RE.test(next)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('username', next)
          .maybeSingle();
        if (error) {
          setUsernameStatus('error');
        } else {
          setUsernameStatus(data ? 'taken' : 'available');
        }
      } catch {
        setUsernameStatus('error');
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [username]);

  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }, []);

  const usernameField = (() => {
    if (usernameStatus === 'invalid')   return { error: '3-24 caracteres, solo a-z, 0-9 y _', icon: null };
    if (usernameStatus === 'taken')     return { error: 'Ese @usuario ya está tomado', icon: null };
    if (usernameStatus === 'error')     return { hint: 'No pudimos verificar. Intenta de nuevo.', icon: null };
    if (usernameStatus === 'checking')  return { hint: 'Verificando disponibilidad...', icon: 'Loader2' };
    if (usernameStatus === 'available') return { success: 'Disponible', icon: 'CheckCircle2' };
    return { hint: 'Mínimo 3 caracteres. a-z, 0-9 y _', icon: null };
  })();

  const canSubmit = (
    !!email.trim() &&
    EMAIL_RE.test(email.trim()) &&
    !!password &&
    isPasswordAcceptable(password) &&
    usernameStatus === 'available'
  );

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
    if (usernameStatus !== 'available') {
      if (!username) setLocalError('Elige un nombre de usuario.');
      else if (usernameStatus === 'taken') setLocalError('Ese @usuario ya está tomado.');
      else if (usernameStatus === 'invalid') setLocalError('Nombre de usuario inválido.');
      else setLocalError('Espera a que verifiquemos tu nombre de usuario.');
      userRef.current?.focus();
      triggerShake();
      return false;
    }
    if (!isPasswordAcceptable(password)) {
      setLocalError('Tu contraseña es demasiado débil. Usa al menos 8 caracteres.');
      passRef.current?.focus();
      triggerShake();
      return false;
    }
    return true;
  }, [email, username, usernameStatus, password, triggerShake]);

  const onSubmit = useCallback(async (e) => {
    e.preventDefault();
    setLocalError(null);
    setInfo(null);
    clearError();
    if (!validate()) return;

    setBusy(true);
    try {
      await signUp(email.trim(), password, {
        username: username.trim().toLowerCase(),
        displayName: displayName.trim() || username.trim(),
      });
      setInfo('¡Cuenta creada! Ya puedes iniciar sesión.');
      // Por seguridad limpiamos el password antes de cambiar vista
      setPassword('');
      // Damos al user un breve momento para ver el mensaje
      setTimeout(() => onGoSignIn(), 1200);
    } catch (err) {
      setLocalError(translateAuthError(err, { context: 'signup' }));
      triggerShake();
    } finally {
      setBusy(false);
    }
  }, [email, password, username, displayName, signUp, clearError, validate, triggerShake, onGoSignIn]);

  return (
    <form
      className={[styles.form, shake && styles.shake].filter(Boolean).join(' ')}
      onSubmit={onSubmit}
      noValidate
    >
      <header className={styles.header}>
        <h1 className={styles.title}>Crea tu cuenta</h1>
        <p className={styles.subtitle}>Únete y descubre música con tus amigos.</p>
      </header>

      <FormSuccess onDismiss={() => setInfo(null)}>{info}</FormSuccess>
      <FormError onDismiss={() => setLocalError(null)}>{localError}</FormError>

      <TextField
        ref={nameRef}
        label="Nombre"
        type="text"
        autoComplete="name"
        iconLeft="User"
        placeholder="Como quieres que te llamen"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        disabled={busy}
        maxLength={60}
        optional
      />

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
        onBlur={handleEmailBlur}
        disabled={busy}
        required
      />

      <TextField
        ref={userRef}
        label="Nombre de usuario"
        type="text"
        autoComplete="username"
        iconLeft="AtSign"
        placeholder="tunombre"
        value={username}
        onChange={handleUsernameChange}
        disabled={busy}
        maxLength={24}
        spellCheck={false}
        required
        suffix={usernameField.icon && (
          <span className={[
            styles.statusIcon,
            usernameField.icon === 'Loader2' && styles.statusIconSpin,
          ].filter(Boolean).join(' ')}>
            <Icon name={usernameField.icon} size={16} />
          </span>
        )}
        error={usernameField.error}
        success={usernameField.success}
        hint={usernameField.hint}
      />

      <PasswordField
        ref={passRef}
        label="Contraseña"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
        required
        minLength={8}
        showStrength
        strengthHint
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        loadingText="Creando cuenta..."
        disabled={!canSubmit}
      >
        Crear cuenta
      </Button>

      <p className={styles.footer}>
        ¿Ya tienes cuenta?{' '}
        <button type="button" className={styles.linkBtn} onClick={onGoSignIn} disabled={busy}>
          Inicia sesión
        </button>
      </p>
    </form>
  );
}
