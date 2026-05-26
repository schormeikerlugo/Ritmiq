/**
 * BloomVariant — animacion 30 dias de racha.
 *
 * Identidad: estrella que florece. Playful pero ya con elegancia.
 *
 * Elementos visuales:
 *   - Slide-down + scale-up del toast.
 *   - Icono Star con bloom (0 → 110% → 100%).
 *   - 6 estrellas SVG en orbita expandiendose.
 *   - 4 rayos radiales pulsantes desde el icono.
 *   - Shimmer plateado en el borde (gradient sweep).
 *
 * Duracion: 5s.
 *
 * @module @ritmiq/ui/components/MilestoneToast/variants/BloomVariant
 */
import { useMemo } from 'react';
import { Icon } from '../../Icon/Icon.jsx';
import { generateParticles, particleCount, lerp } from '../lib/particle-helpers.js';
import styles from './BloomVariant.module.css';

export const BLOOM_DURATION_MS = 5000;

// Estrella de 4 puntas inline SVG. La instanciamos N veces como orbits.
function StarShape() {
  return (
    <svg viewBox="0 0 24 24" className="bloomStarSvg" fill="currentColor" aria-hidden="true">
      <path d="M12 0 L13.7 10.3 L24 12 L13.7 13.7 L12 24 L10.3 13.7 L0 12 L10.3 10.3 Z" />
    </svg>
  );
}

/**
 * Titulo por hito (30, 50). Si el user supera el hito, mostrar racha real.
 */
function pickTitle(milestone, streakValue) {
  if (streakValue > milestone) return `¡${streakValue} dias seguidos!`;
  switch (milestone) {
    case 30: return '¡Un mes completo!';
    case 50: return '¡Cincuenta dias!';
    default: return `¡${milestone} dias!`;
  }
}

function pickSubtitle(milestone, streakValue) {
  if (streakValue > milestone) {
    return `${streakValue} dias de musica diaria.`;
  }
  switch (milestone) {
    case 30: return 'Un mes entero de musica diaria. Increible.';
    case 50: return 'Medio centenar de dias. Constancia digna.';
    default: return `${streakValue ?? milestone} dias de musica diaria.`;
  }
}

export function BloomVariant({ milestone, streakValue, onClose }) {
  const value = streakValue ?? milestone ?? 30;
  const ms = milestone ?? 30;
  const orbitCount = particleCount(6, 4);
  const orbits = useMemo(() => generateParticles(orbitCount, 3030), [orbitCount]);
  const rays = useMemo(() => [0, 90, 180, 270], []);

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.orbitLayer} aria-hidden="true">
        {orbits.map((p) => {
          // Angulo de salida en orbita (radianes)
          const angle = (p.r1 * Math.PI * 2);
          // Distancia final
          const dist = lerp(p.r2, 70, 120);
          // Tamano de la estrella
          const size = lerp(p.r3, 10, 18);
          const dx = Math.cos(angle) * dist;
          const dy = Math.sin(angle) * dist;
          const delay = (p.i * 80);
          // Rotacion final (animacion suave)
          const rot = lerp(p.r4, -120, 360);
          return (
            <span
              key={p.i}
              className={styles.orbitStar}
              style={{
                '--dx': `${dx}px`,
                '--dy': `${dy}px`,
                '--size': `${size}px`,
                '--rot': `${rot}deg`,
                '--delay': `${delay}ms`,
              }}
            >
              <StarShape />
            </span>
          );
        })}
      </div>

      <div className={styles.toast}>
        <div className={styles.shimmer} aria-hidden="true" />
        <div className={styles.iconWrap}>
          <span className={styles.bloomGlow} aria-hidden="true" />
          {rays.map((deg, i) => (
            <span
              key={i}
              className={styles.ray}
              style={{
                transform: `rotate(${deg}deg)`,
                animationDelay: `${i * 120}ms`,
              }}
              aria-hidden="true"
            />
          ))}
          <span className={styles.starIcon} aria-hidden="true">
            <Icon name="Star" size={26} filled />
          </span>
        </div>
        <div className={styles.body}>
          <span className={styles.title}>{pickTitle(ms, value)}</span>
          <span className={styles.subtitle}>{pickSubtitle(ms, value)}</span>
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
