import { useEffect, useRef, useState } from 'react';
import styles from './AuthCard.module.css';

/**
 * Contenedor del form de auth. Aplica:
 *   - Card visual (fondo surface, border, shadow, glass)
 *   - Transicion animada entre vistas (cross-fade + slide vertical sutil)
 *
 * @param {{ mode: string, children: React.ReactNode }} props
 */
export function AuthCard({ mode, children }) {
  const [renderKey, setRenderKey] = useState(mode);
  const [animState, setAnimState] = useState(/** @type {'in'|'out'} */ ('in'));
  const prevMode = useRef(mode);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (prevMode.current === mode) return;
    // Iniciamos animacion de salida...
    setAnimState('out');
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      // ...cuando termina, cambiamos contenido y reentramos
      setRenderKey(mode);
      setAnimState('in');
      prevMode.current = mode;
    }, 160);
    return () => clearTimeout(timeoutRef.current);
  }, [mode]);

  return (
    <div className={styles.card}>
      <div
        key={renderKey}
        className={[styles.viewport, animState === 'out' && styles.viewportOut].filter(Boolean).join(' ')}
      >
        {children}
      </div>
      <footer className={styles.legal}>
        <a href="#" className={styles.legalLink}>Términos</a>
        <span className={styles.legalDot} aria-hidden="true">·</span>
        <a href="#" className={styles.legalLink}>Privacidad</a>
      </footer>
    </div>
  );
}
