/**
 * HomeStats — cards de actividad personal en el Home.
 *
 * Dos cards horizontales:
 *   1. Horas escuchadas en el ultimo mes (Headphones icon).
 *   2. Racha estilo TikTok con estados horarios (Flame icon animado).
 *
 * Estados de la racha (selectStreakState):
 *   - inactive     gris, sin animacion (mensaje "Empieza tu racha")
 *   - fulfilled    naranja vivo, pulse calido (ya escucho hoy)
 *   - calm         naranja-amarillo, mensaje suave (hora < 12 sin play)
 *   - danger       halo azul + jitter (12-18 sin play)
 *   - urgent       jitter aumentado + ceniza cayendo (18-23 sin play)
 *   - last-hour    flama apagandose + countdown MM:SS (23-23:59)
 *   - broken       gris + humo, mensaje "empieza de nuevo"
 *
 * Transicion a fulfilled: cuando snapshot.lastPlayedDate cambia a hoy
 * y el estado anterior NO era fulfilled, disparamos animacion de 700ms
 * con chispas doradas (flame-flora keyframe).
 *
 * @module @ritmiq/ui/components/Home/HomeStats
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useHistoryStore, selectStatsForPeriod } from '../../stores/history.js';
import { useViewStore } from '../../stores/view.js';
import { selectStreakState } from '../../lib/streak-state.js';
import { useStreakTick } from '../../lib/use-streak-tick.js';
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

  const totalMinutes = stats.totalMinutes ?? 0;

  // No mostrar nada si el user nunca tuvo actividad ni record historico.
  const longestStreak = streakSnapshot?.longestStreak ?? stats.longestStreak ?? 0;
  const currentStreak = streakSnapshot?.currentStreak ?? stats.streak ?? 0;
  if (totalMinutes === 0 && currentStreak === 0 && longestStreak === 0) {
    return null;
  }

  return (
    <div className={styles.grid}>
      <HoursCard minutes={totalMinutes} onClick={goStats} />
      <StreakCard onClick={goStats} />
    </div>
  );
}

// ── Card: Horas escuchadas ────────────────────────────────────────────

function HoursCard({ minutes, onClick }) {
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;

  const mainValue = hours >= 1 ? hours : minutes;
  const mainUnit = hours >= 1 ? (hours === 1 ? 'hora' : 'horas') : (minutes === 1 ? 'minuto' : 'minutos');

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
        {hours === 0 && <span className={styles.subValue}>de musica</span>}
      </div>
    </button>
  );
}

// ── Card: Racha (TikTok-style con estados horarios) ───────────────────

function StreakCard({ onClick }) {
  const streakSnapshot = useHistoryStore((s) => s.streakSnapshot);
  const events = useHistoryStore((s) => s.events);

  // Fallback local desde events si snapshot todavia no cargado.
  const fallbackStreak = useMemo(() => {
    const s = selectStatsForPeriod(events, { days: 30 });
    return s.streak ?? 0;
  }, [events]);

  // Calculo en cada render — useStreakTick fuerza re-renders cada 60s
  // (o 1s en last-hour) para que el estado cruce los umbrales horarios
  // sin que el user toque nada. No usamos useMemo porque la fecha
  // implicita (new Date()) cambia entre renders y necesitamos esa
  // frescura para selectStreakState.
  const liveState = selectStreakState({ streakSnapshot, fallbackStreak });
  useStreakTick(liveState.status);

  // Transicion a fulfilled cuando viene de otro estado.
  const prevStatusRef = useRef(liveState.status);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = liveState.status;
    if (prev !== 'fulfilled' && next === 'fulfilled' && prev !== undefined) {
      setTransitioning(true);
      const id = setTimeout(() => setTransitioning(false), 720);
      prevStatusRef.current = next;
      return () => clearTimeout(id);
    }
    prevStatusRef.current = next;
    return undefined;
  }, [liveState.status]);

  const status = liveState.status;
  const showDualParticles = status === 'danger' || status === 'urgent';
  const showAshFall = status === 'urgent' || status === 'last-hour';
  const showSmoke = status === 'last-hour' || status === 'broken';
  const showCountdown = status === 'last-hour' && liveState.countdown;

  return (
    <button
      type="button"
      className={styles.card}
      data-variant="streak"
      data-status={status}
      data-transitioning={transitioning ? 'true' : undefined}
      onClick={onClick}
      aria-label={`Racha: ${liveState.label}. ${liveState.subLabel}`}
    >
      <div className={styles.iconWrap} data-variant="streak" data-status={status}>
        {/* Halo azul-frio para danger/urgent */}
        {(status === 'danger' || status === 'urgent') && (
          <span className={styles.coldHalo} aria-hidden="true" />
        )}

        {/* Flama principal */}
        <span className={styles.flameCore} aria-hidden="true">
          <Icon name="Flame" size={20} filled={liveState.currentStreak >= 1} />
        </span>

        {/* Humo (last-hour / broken) */}
        {showSmoke && (
          <span className={styles.smokeLayer} aria-hidden="true">
            <span className={styles.smoke} style={{ '--delay': '0ms' }} />
            <span className={styles.smoke} style={{ '--delay': '350ms' }} />
            <span className={styles.smoke} style={{ '--delay': '700ms' }} />
          </span>
        )}

        {/* Particulas duales para danger/urgent: chispas arriba + motas azules abajo */}
        {showDualParticles && (
          <span className={styles.dualParticles} aria-hidden="true">
            <span className={styles.sparkUp} style={{ '--delay': '0ms', '--x': '-6px' }} />
            <span className={styles.sparkUp} style={{ '--delay': '300ms', '--x': '4px' }} />
            <span className={styles.sparkUp} style={{ '--delay': '600ms', '--x': '-2px' }} />
            <span className={styles.coldDown} style={{ '--delay': '150ms', '--x': '-5px' }} />
            <span className={styles.coldDown} style={{ '--delay': '500ms', '--x': '6px' }} />
          </span>
        )}

        {/* Cenizas cayendo (urgent / last-hour) */}
        {showAshFall && (
          <span className={styles.ashLayer} aria-hidden="true">
            <span className={styles.ash} style={{ '--delay': '0ms', '--x': '-4px' }} />
            <span className={styles.ash} style={{ '--delay': '400ms', '--x': '5px' }} />
            <span className={styles.ash} style={{ '--delay': '800ms', '--x': '-2px' }} />
          </span>
        )}

        {/* Chispas doradas de transicion a fulfilled */}
        {transitioning && (
          <span className={styles.bloomBurst} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className={styles.bloomSpark}
                style={{
                  '--angle': `${(i * 60)}deg`,
                  '--delay': `${i * 40}ms`,
                }}
              />
            ))}
          </span>
        )}
      </div>

      <div className={styles.cardBody}>
        <span className={styles.label}>{liveState.label}</span>
        <span className={styles.value}>
          {liveState.currentStreak} <span className={styles.unit}>
            {liveState.currentStreak === 1 ? 'día' : 'días'}
          </span>
        </span>
        {showCountdown ? (
          <span className={styles.countdown} aria-live="polite">
            {liveState.countdown}
          </span>
        ) : (
          <span className={styles.subValue}>{liveState.subLabel}</span>
        )}
      </div>
    </button>
  );
}
