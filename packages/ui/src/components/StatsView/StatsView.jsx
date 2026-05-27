/**
 * "Tu mes en Ritmiq" — stats personales de los ultimos 30 dias.
 *
 * Datos agregados desde useHistoryStore via selectStatsForPeriod:
 *  - Totales: plays, minutos, tracks unicos, artistas unicos.
 *  - Top 5 tracks + Top 5 artistas.
 *  - Racha de dias consecutivos escuchando.
 *
 * Sin red — todo se calcula client-side desde el historial cacheado.
 *
 * @module @ritmiq/ui/components/StatsView
 */
import { useMemo, useState } from 'react';
import { useHistoryStore, selectStatsForPeriod } from '../../stores/history.js';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { Icon } from '../Icon/Icon.jsx';
import { EmptyState } from '../primitives/index.js';
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
  { value: 7,   icon: 'Flame',     label: '7 dias',   tier: 'bronze' },
  { value: 30,  icon: 'Star',      label: '30 dias',  tier: 'silver' },
  { value: 100, icon: 'Trophy',    label: '100 dias', tier: 'gold' },
  { value: 365, icon: 'Award',     label: '1 ano',    tier: 'diamond' },
];

export function StatsView() {
  const events = useHistoryStore((s) => s.events);
  const streakSnapshot = useHistoryStore((s) => s.streakSnapshot);
  const milestones = useHistoryStore((s) => s.milestones);
  const replayMilestone = useHistoryStore((s) => s.replayMilestone);
  const playNow = usePlayerStore((s) => s.playNow);
  const goArtist = useViewStore((s) => s.goArtist);
  const [period, setPeriod] = useState(30);

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

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Tu actividad</span>
        <h1 className={styles.title}>Tu {periodLabel} en Ritmiq</h1>
        <p className={styles.subtitle}>
          Lo que mas has escuchado en los ultimos{' '}
          {period === 365 ? '12 meses' : `${period} dias`}.
        </p>
      </header>

      <div className={styles.periodTabs} role="tablist">
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
        <EmptyState
          icon="Music"
          title="Aún no tenemos datos de este periodo"
          subtitle="Reproduce algo y vuelve aquí para ver tus estadísticas."
        />
      ) : (
        <>
          <div className={styles.statsGrid}>
            <StatCard
              icon="ListMusic"
              value={String(stats.totalPlays)}
              label="reproducciones"
            />
            <StatCard
              icon="Music"
              value={fmtMinutes(stats.totalMinutes)}
              label="escuchadas"
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
              icon="CheckCircle2"
              value={String(stats.activeDays)}
              label={stats.activeDays === 1 ? 'dia activo' : 'dias activos'}
            />
            <StatCard
              icon="AlertCircle"
              value={String(stats.streak)}
              label={stats.streak === 1 ? 'dia de racha' : 'dias de racha'}
              highlight={stats.streak >= 3}
            />
            {longestStreak > 0 && (
              <StatCard
                icon="Trophy"
                value={String(longestStreak)}
                label={longestStreak === 1 ? 'dia record' : 'dias record'}
                highlight={longestStreak >= 7}
              />
            )}
          </div>

          {/* ── Trofeos ─────────────────────────────────────────────── */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Trofeos</h2>
            <p className={styles.trophyHint}>
              Desbloquea hitos manteniendo tu racha viva.
            </p>
            <div className={styles.trophyGrid}>
              {MILESTONES_DEFS.map((m) => {
                const unlocked = unlockedSet.has(m.value);
                const achieved = milestones.find((x) => x.milestone === m.value);
                const remaining = Math.max(0, m.value - (stats.streak ?? 0));
                return (
                  <div
                    key={m.value}
                    className={styles.trophyCard}
                    data-tier={m.tier}
                    data-unlocked={unlocked}
                    title={
                      unlocked
                        ? `Desbloqueado el ${achieved?.achievedAt ?? ''}`
                        : `Te faltan ${remaining} ${remaining === 1 ? 'dia' : 'dias'}`
                    }
                  >
                    {unlocked && (
                      <button
                        type="button"
                        className={styles.trophyReplay}
                        onClick={() => replayMilestone(m.value)}
                        aria-label={`Volver a ver animacion de ${m.label}`}
                        title="Volver a ver"
                      >
                        <Icon name="Repeat" size={12} />
                      </button>
                    )}
                    <span className={styles.trophyIcon} aria-hidden="true">
                      <Icon name={m.icon} size={22} filled={unlocked} />
                    </span>
                    <span className={styles.trophyLabel}>{m.label}</span>
                    <span className={styles.trophyState}>
                      {unlocked ? 'Desbloqueado' : `Faltan ${remaining}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {stats.topTracks.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Top canciones</h2>
              <ol className={styles.topList}>
                {stats.topTracks.map((t, i) => (
                  <li key={t.id ?? `t-${i}`} className={styles.topRow}>
                    <span className={styles.topRank}>{i + 1}</span>
                    <button
                      className={styles.topItem}
                      onClick={() => playNow(t)}
                    >
                      <div className={styles.topCover}>
                        {t.coverUrl
                          ? <img src={t.coverUrl} alt="" />
                          : <Icon name="Music" size={18} />}
                      </div>
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
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Top artistas</h2>
              <ol className={styles.topList}>
                {stats.topArtists.map((a, i) => (
                  <li key={`a-${a.artist}`} className={styles.topRow}>
                    <span className={styles.topRank}>{i + 1}</span>
                    <button
                      className={styles.topItem}
                      onClick={() => goArtist(a.artist)}
                    >
                      <div className={styles.topCover} data-shape="circle">
                        {a.coverUrl
                          ? <img src={a.coverUrl} alt="" />
                          : <Icon name="User" size={18} />}
                      </div>
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

function StatCard({ icon, value, label, highlight }) {
  return (
    <div className={styles.statCard} data-highlight={!!highlight}>
      <span className={styles.statIcon} aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
