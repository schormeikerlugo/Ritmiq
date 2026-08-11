/**
 * MilestoneToast — orquestador de modales unicos por hito de racha y horas.
 *
 * Consume `milestoneToastQueue` del useHistoryStore. Cuando llega un
 * milestone (streak o hours), delega al variant correspondiente.
 *
 * TODOS los milestones son MODAL bloqueante con overlay (decision UX
 * 2026-05-26): los hitos son raros y merecen detener al user un momento
 * para que los disfrute conscientemente. El daily diario sigue siendo
 * toast no bloqueante (componente DailyStreakToast aparte).
 *
 * Variantes de RACHA (dias) — derivadas del TIER en streak-milestones.js
 * (estrategia hibrida: 3/7/14 + cada 30 dias hasta el ano + legendarios):
 *   bronze  (3–30)     → SparkVariant
 *   silver  (60–150)   → BloomVariant
 *   gold    (180–330)  → FanfareVariant
 *   diamond (365)      → LegendVariant
 *   legendary (500+)   → LegendVariant
 *
 * Variantes de HORAS:
 *  1h, 10h, 50h, 100h, 500h, 1000h, 5000h → HoursVariant
 *
 * @module @ritmiq/ui/components/MilestoneToast
 */

import { useEffect, useState } from 'react';
import { useHistoryStore } from '../../stores/history.js';
import { Icon } from '../Icon/Icon.jsx';
import { SparkVariant, SPARK_DURATION_MS } from './variants/SparkVariant.jsx';
import { BloomVariant, BLOOM_DURATION_MS } from './variants/BloomVariant.jsx';
import { FanfareVariant, FANFARE_DURATION_MS } from './variants/FanfareVariant.jsx';
import { LegendVariant, LEGEND_DURATION_MS } from './variants/LegendVariant.jsx';
import { HoursVariant, HOURS_DURATION_MS } from './variants/HoursVariant.jsx';
import { pickHourMessage } from '../DailyStreakToast/messages.js';
import { variantForMilestone } from '../../lib/streak-milestones.js';
import styles from './MilestoneToast.module.css';

/**
 * Variante visual (string) -> componente + duracion. La animacion escala
 * con el TIER (magnitud), no con el numero exacto de dias, asi los 18
 * umbrales de la estrategia hibrida reutilizan las 4 animaciones.
 */
const VARIANT_COMPONENTS = {
  spark:   { Component: SparkVariant,   duration: SPARK_DURATION_MS },
  bloom:   { Component: BloomVariant,   duration: BLOOM_DURATION_MS },
  fanfare: { Component: FanfareVariant, duration: FANFARE_DURATION_MS },
  legend:  { Component: LegendVariant,  duration: LEGEND_DURATION_MS },
};

/**
 * Config de variant para un milestone (por dias). Deriva el tier desde el
 * modulo compartido streak-milestones y mapea a su animacion.
 * @param {number} milestone
 */
function variantFor(milestone) {
  return VARIANT_COMPONENTS[variantForMilestone(milestone)] ?? null;
}

const FALLBACK_DURATION_MS = 5000;

export function MilestoneToast() {
  const queue = useHistoryStore((s) => s.milestoneToastQueue);
  const pop = useHistoryStore((s) => s.popMilestoneToast);
  // currentStreak: racha REAL actual. Prioridad sobre streakValue cacheado
  // para que el toast refleje el estado actual del user (bug 2026-05-26).
  const currentStreak = useHistoryStore((s) => s.streakSnapshot?.currentStreak ?? 0);
  const [current, setCurrent] = useState(null);

  // Pop del head cuando hay queue y no hay toast activo.
  useEffect(() => {
    if (!current && queue.length > 0) {
      const next = pop();
      if (next) setCurrent(next);
    }
  }, [queue, current, pop]);

  // Auto-dismiss segun duracion del variant.
  useEffect(() => {
    if (!current) return undefined;
    const duration = pickDuration(current);
    if (duration == null) return undefined;
    const id = setTimeout(() => setCurrent(null), duration);
    return () => clearTimeout(id);
  }, [current]);

  // Esc cierra el modal.
  useEffect(() => {
    if (!current) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setCurrent(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current]);

  if (!current) return null;

  const handleClose = () => setCurrent(null);

  // ── Hits de horas ───────────────────────────────────────────────────
  if (current.type === 'hours') {
    const { title, body } = pickHourMessage(current.hours);
    return (
      <ModalBackdrop onClose={handleClose}>
        <HoursVariant
          hours={current.hours}
          totalHours={current.totalHours}
          title={title}
          body={body}
          onClose={handleClose}
        />
      </ModalBackdrop>
    );
  }

  // ── Hits de racha (default si no type) ──────────────────────────────
  const cfg = variantFor(current.milestone);
  const displayStreak = Math.max(
    currentStreak,
    current.streakValue ?? current.milestone,
  );

  if (cfg?.Component) {
    try {
      return (
        <ModalBackdrop onClose={handleClose}>
          <cfg.Component
            milestone={current.milestone}
            streakValue={displayStreak}
            onClose={handleClose}
          />
        </ModalBackdrop>
      );
    } catch (err) {
      console.warn('[MilestoneToast] variant fallo, usando fallback:', err?.message);
    }
  }

  // Fallback generico.
  return (
    <ModalBackdrop onClose={handleClose}>
      <FallbackToast
        milestone={current.milestone}
        streakValue={displayStreak}
        onClose={handleClose}
      />
    </ModalBackdrop>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

/**
 * Devuelve duracion para el item actual de la cola.
 */
function pickDuration(item) {
  if (item.type === 'hours') return HOURS_DURATION_MS;
  return variantFor(item.milestone)?.duration ?? FALLBACK_DURATION_MS;
}

/**
 * Backdrop semi-transparente que bloquea click-through al contenido de
 * la app. Click en el backdrop cierra el modal. Centra al variant.
 */
function ModalBackdrop({ children, onClose }) {
  return (
    <div
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  );
}

/**
 * Fallback minimo cuando no hay variant para un milestone.
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
