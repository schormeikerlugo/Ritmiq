/**
 * MilestoneToast — orquestador de animaciones unicas por hito de racha.
 *
 * Consume `milestoneToastQueue` del useHistoryStore. Cuando llega un
 * milestone, delega al variant correspondiente (Spark/Bloom/Fanfare/
 * Legend). Cada variant tiene identidad visual y duracion propia.
 *
 *  7d  → SparkVariant    (4s)    playful — llama
 * 30d  → BloomVariant    (5s)    playful — estrella florece
 * 100d → FanfareVariant  (6.5s)  cinematografico — trofeo
 * 365d → LegendVariant   (modal) epico — Continuar manual
 *
 * Si falla un variant (excepcion en render), fallback al toast generico.
 *
 * @module @ritmiq/ui/components/MilestoneToast
 */

import { useEffect, useState } from 'react';
import { useHistoryStore } from '../../stores/history.js';
import { Icon } from '../Icon/Icon.jsx';
import { SparkVariant, SPARK_DURATION_MS } from './variants/SparkVariant.jsx';
import { BloomVariant, BLOOM_DURATION_MS } from './variants/BloomVariant.jsx';
import { FanfareVariant, FANFARE_DURATION_MS } from './variants/FanfareVariant.jsx';
import { LegendVariant, LEGEND_DURATION_MS, LEGEND_IS_MODAL } from './variants/LegendVariant.jsx';
import styles from './MilestoneToast.module.css';

/**
 * Mapeo milestone -> componente variant + duracion. Si `duration` es
 * null el variant es modal (no auto-dismiss).
 */
const VARIANTS = {
  7:   { Component: SparkVariant,   duration: SPARK_DURATION_MS,   isModal: false },
  30:  { Component: BloomVariant,   duration: BLOOM_DURATION_MS,   isModal: false },
  100: { Component: FanfareVariant, duration: FANFARE_DURATION_MS, isModal: false },
  365: { Component: LegendVariant,  duration: LEGEND_DURATION_MS,  isModal: LEGEND_IS_MODAL },
};

const FALLBACK_DURATION_MS = 5000;

export function MilestoneToast() {
  const queue = useHistoryStore((s) => s.milestoneToastQueue);
  const pop = useHistoryStore((s) => s.popMilestoneToast);
  const [current, setCurrent] = useState(null);

  // Pop del head cuando hay queue y no hay toast activo.
  useEffect(() => {
    if (!current && queue.length > 0) {
      const next = pop();
      if (next) setCurrent(next);
    }
  }, [queue, current, pop]);

  // Auto-dismiss segun duracion del variant (skip si modal).
  useEffect(() => {
    if (!current) return undefined;
    const cfg = VARIANTS[current.milestone];
    const duration = cfg?.duration ?? FALLBACK_DURATION_MS;
    // Modal: duration es null -> no auto-dismiss.
    if (duration == null) return undefined;
    const id = setTimeout(() => setCurrent(null), duration);
    return () => clearTimeout(id);
  }, [current]);

  if (!current) return null;

  const cfg = VARIANTS[current.milestone];
  const handleClose = () => setCurrent(null);

  // Render del variant correspondiente. Si no hay variant definido para
  // este milestone (e.g. el equipo anade 500d sin variant), cae al
  // fallback generico abajo.
  if (cfg?.Component) {
    try {
      return (
        <cfg.Component
          streakValue={current.streakValue}
          onClose={handleClose}
        />
      );
    } catch (err) {
      // El variant exploto en render. Loguea y cae al fallback.
      console.warn('[MilestoneToast] variant fallo, usando fallback:', err?.message);
    }
  }

  // Fallback generico — mantiene el comportamiento previo a las variantes.
  return (
    <FallbackToast
      milestone={current.milestone}
      streakValue={current.streakValue}
      onClose={handleClose}
    />
  );
}

/**
 * Fallback simple cuando no hay variant para el milestone o el variant
 * fallo en render. Mantiene la apariencia minima del toast original.
 */
function FallbackToast({ milestone, streakValue, onClose }) {
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.toast}>
        <div className={styles.iconWrap}>
          <Icon name="Flame" size={28} filled />
        </div>
        <div className={styles.body}>
          <span className={styles.title}>¡{milestone} dias de racha!</span>
          <span className={styles.subtitle}>
            {streakValue ?? milestone} dias seguidos.
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
