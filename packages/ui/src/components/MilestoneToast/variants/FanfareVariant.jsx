/**
 * FanfareVariant — animacion 100 dias de racha.
 *
 * Identidad: trofeo dorado con fanfarria. Cinematografico, dramatico.
 *
 * Elementos visuales:
 *   - Flash blanco inicial 200ms.
 *   - Bounce + rotacion 360 del icono Trophy.
 *   - 3 capas: 20 confettis dorados, 8 estrellas grandes, 4 rayos verticales.
 *   - Glow dorado palpitante intenso.
 *   - Titulo con shimmer + subtitulo con typewriter.
 *
 * Duracion: 6.5s.
 *
 * @module @ritmiq/ui/components/MilestoneToast/variants/FanfareVariant
 */
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../Icon/Icon.jsx';
import { generateParticles, particleCount, lerp, prefersReducedMotion } from '../lib/particle-helpers.js';
import styles from './FanfareVariant.module.css';

export const FANFARE_DURATION_MS = 6500;

function BigStar() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0 L14.7 8.3 L23.6 8.6 L16.4 13.9 L19 22.2 L12 17.1 L5 22.2 L7.6 13.9 L0.4 8.6 L9.3 8.3 Z" />
    </svg>
  );
}

/**
 * Titulo dinamico: si el user esta exactamente en 100 dias celebra el
 * hito. Si lleva mas, refleja su estado real.
 */
function pickTitle(streakValue) {
  if (streakValue <= 100) return '¡100 dias!';
  return `¡${streakValue} dias seguidos!`;
}

export function FanfareVariant({ streakValue, onClose }) {
  const value = streakValue ?? 100;
  const reduce = prefersReducedMotion();
  const confettiCount = particleCount(20, 12);
  const starsCount = particleCount(8, 5);

  const confettis = useMemo(() => generateParticles(confettiCount, 1100), [confettiCount]);
  const stars = useMemo(() => generateParticles(starsCount, 2200), [starsCount]);
  const rays = useMemo(() => generateParticles(4, 3300), []);

  // Subtitulo dinamico segun racha actual.
  const FULL_SUBTITLE = `Logro impresionante. ${value} dias sin parar.`;

  // Typewriter del subtitulo (saltarse si reduce-motion).
  const [typedChars, setTypedChars] = useState(reduce ? FULL_SUBTITLE.length : 0);
  useEffect(() => {
    if (reduce) return undefined;
    if (typedChars >= FULL_SUBTITLE.length) return undefined;
    const id = setTimeout(() => setTypedChars((c) => c + 1), 38);
    return () => clearTimeout(id);
  }, [typedChars, reduce, FULL_SUBTITLE.length]);

  const subtitleText = FULL_SUBTITLE.slice(0, typedChars);

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      {/* Flash blanco inicial */}
      <div className={styles.flash} aria-hidden="true" />

      {/* Capa A — confetti cayendo */}
      <div className={styles.confettiLayer} aria-hidden="true">
        {confettis.map((p) => {
          const x = lerp(p.r1, -140, 140);
          const fallY = lerp(p.r2, 200, 320);
          const rot = lerp(p.r3, -540, 540);
          const dur = lerp(p.r4, 1800, 2600);
          const delay = (p.i * 60) % 600;
          // Tono dorado: 38-52
          const hue = lerp(p.r1, 38, 52);
          return (
            <span
              key={`c${p.i}`}
              className={styles.confetti}
              style={{
                '--x': `${x}px`,
                '--y': `${fallY}px`,
                '--rot': `${rot}deg`,
                '--dur': `${dur}ms`,
                '--delay': `${delay}ms`,
                '--hue': hue,
              }}
            />
          );
        })}
      </div>

      {/* Capa B — estrellas que suben con giro */}
      <div className={styles.starsLayer} aria-hidden="true">
        {stars.map((p) => {
          const x = lerp(p.r1, -100, 100);
          const y = lerp(p.r2, -180, -100);
          const size = lerp(p.r3, 16, 26);
          const dur = lerp(p.r4, 1400, 1900);
          const delay = 200 + (p.i * 90);
          return (
            <span
              key={`s${p.i}`}
              className={styles.bigStar}
              style={{
                '--x': `${x}px`,
                '--y': `${y}px`,
                '--size': `${size}px`,
                '--dur': `${dur}ms`,
                '--delay': `${delay}ms`,
              }}
            >
              <BigStar />
            </span>
          );
        })}
      </div>

      {/* Capa C — rayos verticales sweep */}
      <div className={styles.raysLayer} aria-hidden="true">
        {rays.map((p) => {
          const offset = lerp(p.r1, -200, 200);
          const delay = 100 + p.i * 200;
          return (
            <span
              key={`r${p.i}`}
              className={styles.verticalRay}
              style={{
                '--offset': `${offset}px`,
                '--delay': `${delay}ms`,
              }}
            />
          );
        })}
      </div>

      <div className={styles.toast}>
        <div className={styles.iconWrap}>
          <span className={styles.trophyHalo} aria-hidden="true" />
          <span className={styles.trophyInner}>
            <Icon name="Trophy" size={32} filled />
          </span>
        </div>
        <div className={styles.body}>
          <span className={styles.title} data-shimmer="true">{pickTitle(value)}</span>
          <span className={styles.subtitle}>
            {subtitleText}
            {!reduce && typedChars < FULL_SUBTITLE.length && (
              <span className={styles.caret}>|</span>
            )}
          </span>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Cerrar"
        >
          <Icon name="X" size={16} />
        </button>
      </div>
    </div>
  );
}
