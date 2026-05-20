/**
 * Onboarding — modal de 3 pasos que aparece al primer login en cada
 * dispositivo. Persiste el "completado" en localStorage:
 *
 *   ritmiq.onboarding-completed = '1'
 *
 * Se monta solo si:
 *   - hay sesion (auth.user existe)
 *   - el flag no esta en localStorage
 *
 * Por dispositivo (no por cuenta) — un usuario que entra desde 2
 * dispositivos vera el onboarding una vez en cada uno, intencional para
 * familiarizar con cada plataforma (PWA mobile / desktop).
 *
 * @module @ritmiq/ui/components/Onboarding
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/auth.js';
import { Icon } from '../Icon/Icon.jsx';
import logotipoUrl from '../../assets/logotipo.png';
import styles from './Onboarding.module.css';

const LS_KEY = 'ritmiq.onboarding-completed';

const STEPS = [
  {
    icon: null, // usa el logo en vez de un icon
    title: 'Bienvenido a Ritmiq',
    body: 'Tu musica, tu biblioteca, tu sonido. Esto es lo que tienes que saber para empezar.',
    cta: 'Continuar',
  },
  {
    icon: 'Search',
    title: 'Busca y reproduce',
    body: 'Usa la barra superior para encontrar canciones, artistas o pegar un enlace de YouTube. Pulsa Enter o haz click para reproducir.',
    cta: 'Continuar',
  },
  {
    icon: 'Heart',
    title: 'Guarda lo que te gusta',
    body: 'Pulsa el corazon para anadir a Favoritas, o el + para guardar en una playlist. Las canciones guardadas se sincronizan en todos tus dispositivos.',
    cta: 'Empezar',
  },
];

function hasCompleted() {
  if (typeof localStorage === 'undefined') return true;
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return true; }
}
function markCompleted() {
  try { localStorage.setItem(LS_KEY, '1'); } catch {}
}

export function Onboarding() {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!user) return;
    if (hasCompleted()) return;
    // Pequeno delay para que la app respire visualmente antes de bloquear
    // con el modal — evita flash en el primer paint.
    const t = setTimeout(() => setOpen(true), 500);
    return () => clearTimeout(t);
  }, [user]);

  if (!open) return null;

  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleClose = () => {
    markCompleted();
    setOpen(false);
  };
  const handleNext = () => {
    if (isLast) handleClose();
    else setStep((s) => s + 1);
  };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className={styles.card}>
        <button
          type="button"
          className={styles.skip}
          onClick={handleClose}
          aria-label="Saltar tutorial"
        >Saltar</button>

        <div className={styles.iconWrap}>
          {cur.icon ? (
            <div className={styles.iconCircle}>
              <Icon name={cur.icon} size={36} />
            </div>
          ) : (
            <img src={logotipoUrl} alt="Ritmiq" className={styles.logo} />
          )}
        </div>

        <h2 id="onboarding-title" className={styles.title}>{cur.title}</h2>
        <p className={styles.body}>{cur.body}</p>

        <div className={styles.dots} aria-hidden="true">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={styles.dot}
              data-active={i === step}
            />
          ))}
        </div>

        <button
          type="button"
          className={styles.cta}
          onClick={handleNext}
        >
          {cur.cta}
          {!isLast && <Icon name="ChevronRight" size={16} />}
        </button>
      </div>
    </div>
  );
}
