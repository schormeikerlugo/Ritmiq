/**
 * MilestoneToast — confetti + mensaje cuando se desbloquea un trofeo.
 *
 * Consume la cola `milestoneToastQueue` del useHistoryStore. Cuando llega
 * un INSERT a `streak_milestones` via Realtime, el store hace push al
 * queue. Este componente toma el head, muestra un toast 6s con confetti
 * CSS puro, y al cerrar consume el siguiente si existe.
 *
 * No requiere librerias externas: confetti es div absolutos con
 * `transform` + `opacity` animados, ~30 particulas. Bajo CPU.
 *
 * @module @ritmiq/ui/components/MilestoneToast
 */

import { useEffect, useState } from 'react';
import { useHistoryStore } from '../../stores/history.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './MilestoneToast.module.css';

const DURATION_MS = 6000;

const COPY = {
  7:   { title: '¡Primera semana!', subtitle: '7 dias seguidos escuchando.',  icon: 'Flame',  tier: 'bronze' },
  30:  { title: '¡Un mes completo!', subtitle: '30 dias de musica diaria.',    icon: 'Star',   tier: 'silver' },
  100: { title: '¡100 dias!',        subtitle: 'Logro impresionante.',          icon: 'Trophy', tier: 'gold' },
  365: { title: '¡Un ano entero!',   subtitle: 'Eres una leyenda de Ritmiq.',  icon: 'Award',  tier: 'diamond' },
};

export function MilestoneToast() {
  const queue = useHistoryStore((s) => s.milestoneToastQueue);
  const pop = useHistoryStore((s) => s.popMilestoneToast);
  const [current, setCurrent] = useState(null);

  // Cuando entra algo a la cola y no hay toast activo, popea el head.
  useEffect(() => {
    if (!current && queue.length > 0) {
      const next = pop();
      if (next) setCurrent(next);
    }
  }, [queue, current, pop]);

  // Auto-dismiss tras DURATION_MS.
  useEffect(() => {
    if (!current) return undefined;
    const id = setTimeout(() => setCurrent(null), DURATION_MS);
    return () => clearTimeout(id);
  }, [current]);

  if (!current) return null;

  const copy = COPY[current.milestone] ?? {
    title: `¡${current.milestone} dias de racha!`,
    subtitle: 'Sigue asi.',
    icon: 'Flame',
    tier: 'bronze',
  };

  // ~24 particulas de confetti.
  const particles = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div
      className={styles.wrap}
      data-tier={copy.tier}
      role="status"
      aria-live="polite"
    >
      <div className={styles.confettiLayer} aria-hidden="true">
        {particles.map((i) => (
          <span
            key={i}
            className={styles.particle}
            style={{
              '--delay': `${(i * 47) % 800}ms`,
              '--x': `${((i * 37) % 200) - 100}px`,
              '--rot': `${(i * 73) % 360}deg`,
              '--hue': `${(i * 53) % 360}`,
            }}
          />
        ))}
      </div>

      <div className={styles.toast}>
        <div className={styles.iconWrap} data-tier={copy.tier}>
          <Icon name={copy.icon} size={28} filled />
        </div>
        <div className={styles.body}>
          <span className={styles.title}>{copy.title}</span>
          <span className={styles.subtitle}>{copy.subtitle}</span>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={() => setCurrent(null)}
          aria-label="Cerrar"
        >
          <Icon name="X" size={16} />
        </button>
      </div>
    </div>
  );
}
