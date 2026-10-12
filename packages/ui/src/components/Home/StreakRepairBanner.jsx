/**
 * StreakRepairBanner — ofrece recuperar la racha rota con intentos
 * mensuales (5 por mes, 1 por dia faltante, plazo de 48 h).
 *
 * La oferta la calcula la BD (get_streak_repair_offer); aqui solo se
 * muestra y se confirma con repair_streak. Se refresca al montar y al
 * volver a la app, porque la oferta puede abrirse a medianoche sin plays.
 *
 * @module @ritmiq/ui/components/Home/StreakRepairBanner
 */

import { useEffect } from 'react';
import { useHistoryStore } from '../../stores/history.js';
import { toast } from '../../stores/toast.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './StreakRepairBanner.module.css';

/** 'YYYY-MM-DD' -> 'miércoles 14 oct' (dia local, sin desfase UTC). */
function formatDay(key) {
  try {
    return new Date(`${key}T00:00:00`).toLocaleDateString('es', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return key;
  }
}

function nextMonthName() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString('es', { month: 'long' });
}

export function StreakRepairBanner() {
  const offer = useHistoryStore((s) => s.repairOffer);
  const repairing = useHistoryStore((s) => s.repairing);
  const loadRepairOffer = useHistoryStore((s) => s.loadRepairOffer);
  const repairStreak = useHistoryStore((s) => s.repairStreak);

  useEffect(() => {
    loadRepairOffer();
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadRepairOffer();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadRepairOffer]);

  if (!offer || (offer.reason !== 'ok' && offer.reason !== 'not_enough')) return null;

  const cost = offer.cost ?? 1;
  const missed = offer.missed_days ?? [];
  const canRepair = offer.reason === 'ok';
  const missedText = cost === 1
    ? `Faltaste el ${formatDay(missed[0])}`
    : `Faltaste ${cost} días`;

  const onRepair = async () => {
    const ok = await repairStreak();
    if (ok) {
      toast.success(`¡Racha recuperada! ${offer.restored_streak} días`, { icon: 'Flame' });
    } else {
      toast.error('No se pudo recuperar la racha. Inténtalo de nuevo.');
    }
  };

  return (
    <div className={styles.banner} data-disabled={canRepair ? undefined : 'true'}>
      <span className={styles.icon} aria-hidden="true">
        <Icon name="Flame" size={20} filled={canRepair} />
      </span>
      <div className={styles.body}>
        <span className={styles.title}>
          Recupera tu racha de {offer.restored_streak} días
        </span>
        <span className={styles.sub}>
          {canRepair
            ? `${missedText}. Cuesta ${cost} ${cost === 1 ? 'intento' : 'intentos'} · te quedan ${offer.remaining} de ${offer.monthly_limit} este mes. Disponible hasta el ${formatDay(offer.deadline)}.`
            : `${missedText} y te ${offer.remaining === 1 ? 'queda' : 'quedan'} ${offer.remaining} ${offer.remaining === 1 ? 'intento' : 'intentos'}. Se renuevan el 1 de ${nextMonthName()}.`}
        </span>
      </div>
      {canRepair && (
        <button
          type="button"
          className={styles.action}
          onClick={onRepair}
          disabled={repairing}
        >
          {repairing ? <Icon name="Loader2" size={16} className={styles.spin} /> : 'Recuperar'}
        </button>
      )}
    </div>
  );
}
