/**
 * HoursVariant — modal para hitos de horas escuchadas (1, 10, 50, 100,
 * 500, 1000, 5000 horas totales).
 *
 * Identidad visual: notas musicales flotantes en azul electrico.
 * Diferenciado de los streak milestones (que son fuego/dorado/platino)
 * por la paleta azul-cian, signalizando "tiempo escuchado" vs "habito
 * diario".
 *
 * Intensidad escala con el tier:
 *   tier1 (1, 10h)        suave, 5s
 *   tier2 (50, 100h)      brillante, 6s
 *   tier3 (500, 1000h)    intenso, 7s
 *   tier4 (5000h)         epico, 8s
 *
 * @module @ritmiq/ui/components/MilestoneToast/variants/HoursVariant
 */
import { useMemo } from 'react';
import { Icon } from '../../Icon/Icon.jsx';
import { generateParticles, particleCount, lerp } from '../lib/particle-helpers.js';
import styles from './HoursVariant.module.css';

export const HOURS_DURATION_MS = 6000;

function tierForHours(hours) {
  if (hours >= 5000) return 'tier4';
  if (hours >= 500)  return 'tier3';
  if (hours >= 50)   return 'tier2';
  return 'tier1';
}

export function HoursVariant({ hours, totalHours, title, body, onClose }) {
  const tier = tierForHours(hours);
  const noteCount = particleCount(12, 8);
  const notes = useMemo(() => generateParticles(noteCount, hours * 31), [noteCount, hours]);

  return (
    <div className={styles.wrap} data-tier={tier} role="status" aria-live="polite">
      <div className={styles.notesLayer} aria-hidden="true">
        {notes.map((p) => {
          const x = lerp(p.r1, -90, 90);
          const y = lerp(p.r2, -160, -90);
          const rot = lerp(p.r3, -45, 45);
          const dur = lerp(p.r4, 1400, 2200);
          const delay = (p.i * 90) % 800;
          return (
            <span
              key={p.i}
              className={styles.note}
              style={{
                '--x': `${x}px`,
                '--y': `${y}px`,
                '--rot': `${rot}deg`,
                '--dur': `${dur}ms`,
                '--delay': `${delay}ms`,
              }}
            >
              <Icon name="Music" size={14} filled />
            </span>
          );
        })}
      </div>

      <div className={styles.toast}>
        <div className={styles.iconWrap}>
          <span className={styles.iconGlow} aria-hidden="true" />
          <Icon name="Headphones" size={30} filled />
        </div>
        <div className={styles.body}>
          <span className={styles.title}>{title}</span>
          <span className={styles.subtitle}>{body}</span>
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
