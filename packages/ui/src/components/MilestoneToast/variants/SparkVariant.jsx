/**
 * SparkVariant — animacion hitos chicos de racha (3, 7, 14 dias).
 *
 * Identidad: chispa que prende. Playful, calido, espontaneo.
 *
 * Elementos visuales:
 *   - Entrada elastica del toast.
 *   - Icono Flame con flicker continuo.
 *   - 10 partículas de fuego (gotas) subiendo con jitter horizontal.
 *   - Borde palpitante naranja.
 *
 * Duracion: 4s. Auto-dismiss.
 *
 * @module @ritmiq/ui/components/MilestoneToast/variants/SparkVariant
 */
import { useMemo } from 'react';
import { Icon } from '../../Icon/Icon.jsx';
import { generateParticles, particleCount, lerp } from '../lib/particle-helpers.js';
import styles from './SparkVariant.module.css';

export const SPARK_DURATION_MS = 4500;

/**
 * Titulo segun el hito alcanzado. Cada milestone tiene texto unico.
 * Si la racha actual del user supera el hito (welcome/replay), refleja
 * la realidad actual en lugar del hito original.
 */
function pickTitle(milestone, streakValue) {
  if (streakValue > milestone) return `¡${streakValue} dias seguidos!`;
  switch (milestone) {
    case 3:  return '¡Tres dias!';
    case 7:  return '¡Primera semana!';
    case 14: return '¡Dos semanas!';
    default: return `¡${milestone} dias!`;
  }
}

function pickSubtitle(milestone, streakValue) {
  if (streakValue > milestone) {
    return `${streakValue} dias seguidos escuchando.`;
  }
  switch (milestone) {
    case 3:  return 'Tres dias seguidos. Vas construyendo el habito.';
    case 7:  return 'Una semana entera de musica. Asi se hace.';
    case 14: return 'Dos semanas. Tu racha ya es habito.';
    default: return `${streakValue ?? milestone} dias seguidos.`;
  }
}

export function SparkVariant({ milestone, streakValue, onClose }) {
  const value = streakValue ?? milestone ?? 7;
  const ms = milestone ?? 7;
  const count = particleCount(10, 6);
  const sparks = useMemo(() => generateParticles(count, 7777), [count]);

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.sparksLayer} aria-hidden="true">
        {sparks.map((p) => {
          // x: jitter horizontal -22..22px
          const x = lerp(p.r1, -22, 22);
          // y final: subida 80..130px
          const y = lerp(p.r2, -130, -80);
          // hue: rango naranja-rojo 12..50
          const hue = lerp(p.r3, 12, 50);
          // duracion individual 800..1300ms
          const dur = lerp(p.r4, 800, 1300);
          // delay escalonado
          const delay = (p.i * 70) % 700;
          return (
            <span
              key={p.i}
              className={styles.spark}
              style={{
                '--x': `${x}px`,
                '--y': `${y}px`,
                '--hue': hue,
                '--dur': `${dur}ms`,
                '--delay': `${delay}ms`,
              }}
            />
          );
        })}
      </div>

      <div className={styles.toast}>
        <div className={styles.iconWrap}>
          <span className={styles.flameGlow} aria-hidden="true" />
          <Icon name="Flame" size={28} filled />
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
