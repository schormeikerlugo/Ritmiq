/**
 * HomeStats — cards de actividad personal en el Home.
 *
 * Dos cards horizontales:
 *   1. Horas escuchadas en el ultimo mes (Headphones icon).
 *   2. Dias de racha consecutivos (Flame icon, animado).
 *
 * Reutiliza selectStatsForPeriod del store de history (sin duplicar
 * logica). Click en cualquier card navega a la vista de Stats completa.
 *
 * Si el usuario no tiene historial todavia (totalMinutes === 0 &&
 * streak === 0), el componente no se renderiza — evita mostrar zeros
 * desmoralizantes en cuentas nuevas.
 *
 * @module @ritmiq/ui/components/Home/HomeStats
 */

import { useMemo } from 'react';
import { useHistoryStore, selectStatsForPeriod } from '../../stores/history.js';
import { useViewStore } from '../../stores/view.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './HomeStats.module.css';

export function HomeStats() {
  const events = useHistoryStore((s) => s.events);
  const streakSnapshot = useHistoryStore((s) => s.streakSnapshot);
  const goStats = useViewStore((s) => s.goStats);

  const stats = useMemo(
    () => selectStatsForPeriod(events, { days: 30, streakSnapshot }),
    [events, streakSnapshot],
  );

  const totalMinutes  = stats.totalMinutes ?? 0;
  const streak        = stats.streak ?? 0;
  const longestStreak = stats.longestStreak ?? 0;

  // No mostrar las cards si el usuario aun no tiene actividad.
  if (totalMinutes === 0 && streak === 0 && longestStreak === 0) return null;

  return (
    <div className={styles.grid}>
      <HoursCard minutes={totalMinutes} onClick={goStats} />
      <StreakCard streak={streak} longestStreak={longestStreak} onClick={goStats} />
    </div>
  );
}

// ── Card: Horas escuchadas ────────────────────────────────────────────

function HoursCard({ minutes, onClick }) {
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;

  // Valor principal: prefiere horas si >= 1, sino minutos.
  const mainValue = hours >= 1 ? hours : minutes;
  const mainUnit  = hours >= 1 ? (hours === 1 ? 'hora' : 'horas') : (minutes === 1 ? 'minuto' : 'minutos');

  return (
    <button
      type="button"
      className={styles.card}
      data-variant="hours"
      onClick={onClick}
      aria-label={`${mainValue} ${mainUnit} escuchadas este mes`}
    >
      <div className={styles.iconWrap} data-variant="hours">
        <Icon name="Headphones" size={20} />
      </div>
      <div className={styles.cardBody}>
        <span className={styles.label}>Este mes</span>
        <span className={styles.value}>
          {mainValue} <span className={styles.unit}>{mainUnit}</span>
        </span>
        {hours >= 1 && remainingMin > 0 && (
          <span className={styles.subValue}>y {remainingMin} min</span>
        )}
        {hours === 0 && (
          <span className={styles.subValue}>de musica</span>
        )}
      </div>
    </button>
  );
}

// ── Card: Racha ────────────────────────────────────────────────────────

function StreakCard({ streak, longestStreak = 0, onClick }) {
  // Tier de intensidad: ajusta el visual segun la racha.
  // 0     → gris, sin animacion (mensaje "Empieza tu racha")
  // 1-2   → naranja base, animacion lenta
  // 3-6   → naranja-rojo, animacion normal
  // 7+    → rojo intenso, glow grande, animacion rapida
  let tier = 'zero';
  if (streak >= 7)      tier = 'hot';
  else if (streak >= 3) tier = 'mid';
  else if (streak >= 1) tier = 'low';

  // Detectar empate con record historico (igualando record).
  // Si current === longest Y longest >= 3, lo marcamos visualmente.
  const matchingRecord = streak > 0 && streak === longestStreak && longestStreak >= 3;
  // Hay record historico mayor que la racha actual.
  const hasHigherRecord = longestStreak > streak && longestStreak >= 3;

  const label = (() => {
    if (streak === 0 && longestStreak === 0) return 'Empieza tu racha hoy';
    if (streak === 0 && longestStreak > 0) return 'Recupera tu racha';
    if (matchingRecord) return '¡Igualas tu récord!';
    if (streak === 1) return '¡Primer día!';
    if (streak === 2) return 'Sigue así';
    if (streak >= 7)  return 'En racha';
    return 'En racha';
  })();

  return (
    <button
      type="button"
      className={styles.card}
      data-variant="streak"
      data-tier={tier}
      onClick={onClick}
      aria-label={`Racha de ${streak} ${streak === 1 ? 'día' : 'días'}${longestStreak > 0 ? `. Récord: ${longestStreak}` : ''}`}
    >
      <div className={styles.iconWrap} data-variant="streak" data-tier={tier}>
        <Icon name="Flame" size={20} filled={streak >= 1} />
      </div>
      <div className={styles.cardBody}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>
          {streak} <span className={styles.unit}>
            {streak === 1 ? 'día' : 'días'}
          </span>
        </span>
        {hasHigherRecord && (
          <span className={styles.subValue}>récord: {longestStreak}</span>
        )}
        {!hasHigherRecord && streak >= 1 && (
          <span className={styles.subValue}>
            {matchingRecord ? '¡tu mejor racha!' : 'consecutivos'}
          </span>
        )}
      </div>
    </button>
  );
}
