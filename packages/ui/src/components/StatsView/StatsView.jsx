/**
 * "Tu actividad" — stats personales del periodo seleccionado.
 *
 * Datos agregados desde useHistoryStore via selectStatsForPeriod:
 *  - Totales: plays, minutos, tracks únicos, artistas únicos.
 *  - Top 5 tracks + Top 5 artistas.
 *  - Racha de días consecutivos escuchando + récord histórico.
 *
 * Sin red — todo se calcula client-side desde el historial cacheado.
 * Entrada animada con GSAP (stagger), respeta prefers-reduced-motion.
 *
 * @module @ritmiq/ui/components/StatsView
 */
import { useMemo, useRef, useState } from 'react';
import { useHistoryStore, selectStatsForPeriod } from '../../stores/history.js';
import { ActivityHeatmap } from './ActivityHeatmap.jsx';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { useViewTransition } from '../../lib/use-view-transition.js';
import { Icon } from '../Icon/Icon.jsx';
import { CoverArt, EmptyState } from '../primitives/index.js';
import styles from './StatsView.module.css';

const PERIODS = [
  { id: 7,   label: 'Semana' },
  { id: 30,  label: 'Mes' },
  { id: 90,  label: '3 meses' },
  { id: 365, label: 'Año' },
];

function fmtMinutes(min) {
  if (!Number.isFinite(min) || min < 0) return '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

const MILESTONES_DEFS = [
  { value: 7,   icon: 'Flame',  label: '7 días',   tier: 'bronze' },
  { value: 30,  icon: 'Star',   label: '30 días',  tier: 'silver' },
  { value: 100, icon: 'Trophy', label: '100 días', tier: 'gold' },
  { value: 365, icon: 'Award',  label: '1 año',    tier: 'diamond' },
];

export function StatsView() {
  const events = useHistoryStore((s) => s.events);
  const streakSnapshot = useHistoryStore((s) => s.streakSnapshot);
  const milestones = useHistoryStore((s) => s.milestones);
  const replayMilestone = useHistoryStore((s) => s.replayMilestone);
  const playNow = usePlayerStore((s) => s.playNow);
  const goArtist = useViewStore((s) => s.goArtist);
  const goHistory = useViewStore((s) => s.goHistory);
  const [period, setPeriod] = useState(30);

  const rootRef = useRef(null);
  // Stagger de entrada de las secciones de nivel superior. Cambia con el
  // periodo para re-animar al alternar tabs.
  useViewTransition(rootRef, {
    preset: 'stagger',
    deps: [period],
    childSelector: `.${styles.animBlock}`,
    staggerEach: 0.05,
  });

  const stats = useMemo(
    () => selectStatsForPeriod(events, { days: period, topLimit: 5, streakSnapshot }),
    [events, period, streakSnapshot]
  );

  const unlockedSet = useMemo(
    () => new Set(milestones.map((m) => m.milestone)),
    [milestones]
  );
  const longestStreak = stats.longestStreak ?? 0;

  const periodLabel = PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? 'periodo';
  const periodDaysLabel = period === 365 ? '12 meses' : `${period} días`;

  // Contexto derivado para sublabels: promedio diario de minutos sobre los
  // días activos (no sobre el periodo entero, así refleja la intensidad
  // real de escucha en los días que sí usó la app).
  const avgMinPerActiveDay = stats.activeDays > 0
    ? Math.round(stats.totalMinutes / stats.activeDays)
    : 0;
  const avgPlaysPerActiveDay = stats.activeDays > 0
    ? Math.round(stats.totalPlays / stats.activeDays)
    : 0;

  return (
    <section className={styles.wrap} ref={rootRef}>
      <header className={`${styles.header} ${styles.animBlock}`}>
        <div className={styles.headerText}>
          <span className={styles.eyebrow}>
            <span className={styles.eyebrowDot} aria-hidden="true" />
            Tu actividad
          </span>
          <h1 className={styles.title}>Tu {periodLabel} en Ritmiq</h1>
          <p className={styles.subtitle}>
            Lo que más has escuchado en los últimos {periodDaysLabel}.
          </p>
        </div>
        <button
          type="button"
          className={styles.historyLink}
          onClick={goHistory}
        >
          <Icon name="Clock" size={14} />
          <span>Ver historial completo</span>
        </button>
      </header>

      <div className={`${styles.periodTabs} ${styles.animBlock}`} role="tablist" aria-label="Periodo">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={period === p.id}
            data-active={period === p.id}
            className={styles.periodTab}
            onClick={() => setPeriod(p.id)}
          >{p.label}</button>
        ))}
      </div>

      {stats.totalPlays === 0 ? (
        <div className={styles.animBlock}>
          <EmptyState
            icon="Music"
            title="Aún no tenemos datos de este periodo"
            subtitle="Reproduce algo y vuelve aquí para ver tus estadísticas."
          />
        </div>
      ) : (
        <>
          {/* ── Bento de métricas ─────────────────────────────────────
              La racha actual es la métrica emocional → card grande
              destacada. El resto son métricas neutras en grid. */}
          <div className={`${styles.bento} ${styles.animBlock}`}>
            <FeatureStreakCard
              streak={stats.streak}
              longest={longestStreak}
            />
            <div className={styles.bentoGrid}>
              <StatCard
                icon="ListMusic"
                value={String(stats.totalPlays)}
                label="reproducciones"
                hint={avgPlaysPerActiveDay > 0 ? `~${avgPlaysPerActiveDay}/día activo` : undefined}
              />
              <StatCard
                icon="Headphones"
                value={fmtMinutes(stats.totalMinutes)}
                label="escuchadas"
                hint={avgMinPerActiveDay > 0 ? `~${fmtMinutes(avgMinPerActiveDay)}/día` : undefined}
              />
              <StatCard
                icon="Disc3"
                value={String(stats.uniqueTracks)}
                label="canciones distintas"
              />
              <StatCard
                icon="User"
                value={String(stats.uniqueArtists)}
                label="artistas distintos"
              />
              <StatCard
                icon="CalendarDays"
                value={String(stats.activeDays)}
                label={stats.activeDays === 1 ? 'día activo' : 'días activos'}
              />
              <StatCard
                icon="Trophy"
                value={String(longestStreak)}
                label={longestStreak === 1 ? 'día récord' : 'días récord'}
                accent={longestStreak >= 7}
              />
            </div>
          </div>

          {/* ── Heatmap anual ───────────────────────────────────────── */}
          <div className={styles.animBlock}>
            <ActivityHeatmap events={events} />
          </div>

          {/* ── Trofeos ─────────────────────────────────────────────── */}
          <section className={`${styles.section} ${styles.animBlock}`}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Trofeos</h2>
              <p className={styles.sectionSub}>
                Desbloquea hitos manteniendo tu racha viva.
              </p>
            </div>
            <div className={styles.trophyGrid}>
              {MILESTONES_DEFS.map((m) => {
                const unlocked = unlockedSet.has(m.value);
                const achieved = milestones.find((x) => x.milestone === m.value);
                const current = stats.streak ?? 0;
                const remaining = Math.max(0, m.value - current);
                const progress = unlocked
                  ? 100
                  : Math.min(100, Math.round((current / m.value) * 100));
                return (
                  <div
                    key={m.value}
                    className={styles.trophyCard}
                    data-tier={m.tier}
                    data-unlocked={unlocked}
                  >
                    {unlocked && (
                      <button
                        type="button"
                        className={styles.trophyReplay}
                        onClick={() => replayMilestone(m.value)}
                        aria-label={`Volver a ver la animación de ${m.label}`}
                        title="Volver a ver"
                      >
                        <Icon name="Repeat" size={12} />
                      </button>
                    )}
                    <span className={styles.trophyIcon} aria-hidden="true">
                      <Icon name={m.icon} size={24} filled={unlocked} />
                    </span>
                    <span className={styles.trophyLabel}>{m.label}</span>

                    {unlocked ? (
                      <span className={styles.trophyState} data-unlocked="true">
                        <Icon name="Check" size={11} /> Desbloqueado
                      </span>
                    ) : (
                      <>
                        <div className={styles.trophyBar} aria-hidden="true">
                          <span
                            className={styles.trophyBarFill}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className={styles.trophyState}>
                          {remaining === 1 ? 'Falta 1 día' : `Faltan ${remaining} días`}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {stats.topTracks.length > 0 && (
            <section className={`${styles.section} ${styles.animBlock}`}>
              <h2 className={styles.sectionTitle}>Top canciones</h2>
              <ol className={styles.topList}>
                {stats.topTracks.map((t, i) => (
                  <li key={t.id ?? `t-${i}`} className={styles.topRow}>
                    <span className={styles.topRank} data-medal={i < 3 ? i + 1 : undefined}>
                      {i + 1}
                    </span>
                    <button
                      className={styles.topItem}
                      onClick={() => playNow(t)}
                    >
                      <CoverArt coverUrl={t.coverUrl} seed={t.title || t.artist} size={44} radius="sm" />
                      <div className={styles.topMeta}>
                        <span className={styles.topTitle}>{t.title}</span>
                        <span className={styles.topSub}>{t.artist ?? '—'}</span>
                      </div>
                      <span className={styles.topCount}>
                        {t.playCount} {t.playCount === 1 ? 'play' : 'plays'}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {stats.topArtists.length > 0 && (
            <section className={`${styles.section} ${styles.animBlock}`}>
              <h2 className={styles.sectionTitle}>Top artistas</h2>
              <ol className={styles.topList}>
                {stats.topArtists.map((a, i) => (
                  <li key={`a-${a.artist}`} className={styles.topRow}>
                    <span className={styles.topRank} data-medal={i < 3 ? i + 1 : undefined}>
                      {i + 1}
                    </span>
                    <button
                      className={styles.topItem}
                      onClick={() => goArtist(a.artist)}
                    >
                      <CoverArt coverUrl={a.coverUrl} seed={a.artist} size={44} radius="pill" />
                      <div className={styles.topMeta}>
                        <span className={styles.topTitle}>{a.artist}</span>
                      </div>
                      <span className={styles.topCount}>
                        {a.playCount} {a.playCount === 1 ? 'play' : 'plays'}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Card grande destacada de la racha actual (métrica emocional).
 * Muestra la racha activa con icono de llama + el récord como referencia.
 */
function FeatureStreakCard({ streak, longest }) {
  const isRecord = streak > 0 && streak >= longest;
  return (
    <div className={styles.streakCard} data-active={streak >= 3}>
      <div className={styles.streakGlow} aria-hidden="true" />
      <span className={styles.streakIcon} aria-hidden="true">
        <Icon name="Flame" size={28} filled={streak >= 1} />
      </span>
      <div className={styles.streakBody}>
        <span className={styles.streakValue}>{streak}</span>
        <span className={styles.streakLabel}>
          {streak === 1 ? 'día de racha' : 'días de racha'}
        </span>
      </div>
      <span className={styles.streakFoot}>
        {isRecord && streak > 0
          ? '¡Estás en tu mejor racha!'
          : longest > 0
            ? `Tu récord: ${longest} ${longest === 1 ? 'día' : 'días'}`
            : 'Escucha algo cada día para construir tu racha.'}
      </span>
    </div>
  );
}

function StatCard({ icon, value, label, hint, accent }) {
  return (
    <div className={styles.statCard} data-accent={!!accent}>
      <span className={styles.statIcon} aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
  );
}
