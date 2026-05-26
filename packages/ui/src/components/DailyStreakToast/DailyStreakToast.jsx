/**
 * DailyStreakToast — toast cariñoso que aparece UNA VEZ al dia cuando el
 * user activa su racha diaria (escucha algo el dia LOCAL de hoy).
 *
 * No bloquea (auto-dismiss en 7s + boton X). Diferenciado por intensity
 * segun los dias de racha actual:
 *   ember   1d       chispa naciente, calida
 *   spark   2-6d     fuego pequeno
 *   flame   7-29d    fuego firme con brillo
 *   bloom   30-99d   flor brillante
 *   fanfare 100-364d aura dorada
 *   legend  365+d    aura platino
 *
 * Mensajes rotativos (12+ por nivel) con seleccion estable por dia para
 * que un reload no cambie el texto.
 *
 * Prioridad: si hay un MilestoneToast activo en la cola, NO se muestra
 * (el milestone es mas raro y prioritario). Tras dismiss del milestone,
 * el daily aparece naturalmente en el siguiente render.
 *
 * Persistencia cross-device: marca `last_daily_celebrated_date` en
 * user_streaks ANTES del render para evitar race en multidevice.
 *
 * @module @ritmiq/ui/components/DailyStreakToast
 */
import { useEffect, useState, useRef } from 'react';
import { useHistoryStore, todayLocalDateStr } from '../../stores/history.js';
import { Icon } from '../Icon/Icon.jsx';
import { pickMessage } from './messages.js';
import styles from './DailyStreakToast.module.css';

const DURATION_MS = 7000;

/** Icono segun intensity. */
const ICON_BY_INTENSITY = {
  ember:   'Flame',
  spark:   'Flame',
  flame:   'Flame',
  bloom:   'Sparkles',
  fanfare: 'Sparkles',
  legend:  'Sparkles',
};

export function DailyStreakToast() {
  const streakSnapshot = useHistoryStore((s) => s.streakSnapshot);
  const queueLen = useHistoryStore((s) => s.milestoneToastQueue.length);
  const shouldShow = useHistoryStore((s) => s.shouldShowDailyStreak);
  const markCelebrated = useHistoryStore((s) => s.markDailyStreakCelebrated);

  // Snapshot del payload del toast (capturado al disparar). Vivira hasta
  // que el user lo cierre o auto-dismiss.
  const [payload, setPayload] = useState(null);
  // Ref para evitar dispararlo dos veces si Realtime/effect re-corre.
  const firedRef = useRef(false);

  // Decidir si disparar.
  useEffect(() => {
    if (payload) return undefined;            // ya hay uno activo
    if (firedRef.current) return undefined;   // ya lo disparamos en esta sesion
    if (queueLen > 0) return undefined;       // milestone en cola tiene prioridad
    if (!shouldShow()) return undefined;

    const days = streakSnapshot?.currentStreak ?? 0;
    const today = todayLocalDateStr();
    const msg = pickMessage(days, today);

    firedRef.current = true;
    // Marcar PRIMERO (optimistic) para evitar re-disparo cross-device en
    // el mismo tick. La actualizacion local en el store hace que
    // shouldShow() retorne false en el proximo render.
    markCelebrated();

    setPayload({ days, ...msg });
    return undefined;
  }, [payload, queueLen, shouldShow, streakSnapshot?.currentStreak, markCelebrated]);

  // Auto-dismiss.
  useEffect(() => {
    if (!payload) return undefined;
    const id = setTimeout(() => setPayload(null), DURATION_MS);
    return () => clearTimeout(id);
  }, [payload]);

  if (!payload) return null;

  const iconName = ICON_BY_INTENSITY[payload.intensity] ?? 'Flame';

  return (
    <div
      className={styles.wrap}
      data-intensity={payload.intensity}
      role="status"
      aria-live="polite"
    >
      <div className={styles.toast}>
        <div className={styles.iconWrap}>
          <span className={styles.iconGlow} aria-hidden="true" />
          <Icon name={iconName} size={26} filled />
        </div>
        <div className={styles.body}>
          <span className={styles.title}>{payload.title}</span>
          <span className={styles.subtitle}>{payload.body}</span>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={() => setPayload(null)}
          aria-label="Cerrar"
        >
          <Icon name="X" size={16} />
        </button>
      </div>
    </div>
  );
}
