import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { AuthHero } from './AuthHero.jsx';
import { AuthCard } from './AuthCard.jsx';
import { SignInView } from './views/SignInView.jsx';
import { SignUpView } from './views/SignUpView.jsx';
import { ForgotPasswordView } from './views/ForgotPasswordView.jsx';
import styles from './AuthScreen.module.css';

/**
 * Shell del flujo de autenticacion.
 *
 * Mantiene el `mode` actual (signin | signup | forgot) y orquesta la transicion
 * animada entre vistas via la prop `view` de <AuthCard>. Layout split en desktop
 * (hero izq + card der) y stacked en mobile (hero compact arriba + card abajo).
 */
export function AuthScreen() {
  const [mode, setMode] = useState(/** @type {'signin'|'signup'|'forgot'} */ ('signin'));
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  );

  // Tracking responsive del viewport para alternar hero compact / full
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Detecta si veniamos de un reset password (#access_token=...&type=recovery).
  // Si es asi, App.jsx ya esta renderizando <ResetPasswordView/> en otro lugar
  // (futura sesion 2). Aqui solo limpiamos el hash al montar si no aplica.
  const goSignIn = useCallback(() => setMode('signin'), []);
  const goSignUp = useCallback(() => setMode('signup'), []);
  const goForgot = useCallback(() => setMode('forgot'), []);

  const view = useMemo(() => {
    switch (mode) {
      case 'signup': return <SignUpView onGoSignIn={goSignIn} />;
      case 'forgot': return <ForgotPasswordView onGoSignIn={goSignIn} />;
      case 'signin':
      default:       return <SignInView onGoSignUp={goSignUp} onGoForgot={goForgot} />;
    }
  }, [mode, goSignIn, goSignUp, goForgot]);

  return (
    <div className={styles.screen}>
      <div className={styles.heroPane}>
        <AuthHero compact={isMobile} />
      </div>
      <div className={styles.cardPane}>
        <AuthCard mode={mode}>{view}</AuthCard>
      </div>
    </div>
  );
}
