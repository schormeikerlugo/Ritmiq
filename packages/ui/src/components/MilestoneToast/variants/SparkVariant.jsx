/**
 * SparkVariant — animacion 7 dias de racha.
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

export const SPARK_DURATION_MS = 4000;

export function SparkVariant({ streakValue, onClose }) {
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
          <span className={styles.title}>¡Primera semana!</span>
          <span className={styles.subtitle}>
            {streakValue ?? 7} dias seguidos escuchando.
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
