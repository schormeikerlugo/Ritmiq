/**
 * MonthlyWrapped \u2014 modal "Tu mes en Ritmiq" estilo Spotify Wrapped.
 *
 * Muestra resumen del mes anterior:
 *   - Total de plays + minutos escuchados.
 *   - Top 3 tracks (con cover + rank).
 *   - Top 3 artistas.
 *   - Dia mas activo.
 *
 * Triggering automatico:
 *   - Solo se auto-abre 1 vez por mes despues del dia 1. Si hoy es
 *     >= dia 2 del mes M y no hay flag `ritmiq.wrapped-seen-<M-1>`,
 *     se dispara. Setea el flag al cerrar.
 *
 * Trigger manual (futuro): boton en StatsView que llame openWrapped().
 *
 * @module @ritmiq/ui/components/StatsView/MonthlyWrapped
 */
import { useEffect, useMemo, useState } from 'react';
import { useHistoryStore } from '../../stores/history.js';
import { usePlayerStore } from '../../stores/player.js';
import { Modal } from '../Modal/Modal.jsx';
import { Icon } from '../Icon/Icon.jsx';
import { CoverArt } from '../primitives/CoverArt.jsx';
import styles from './MonthlyWrapped.module.css';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function previousMonthRange() {
  const now = new Date();
  // Primer dia del mes actual.
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  return { start, end };
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function eventsInRange(events, start, end) {
  const s = start.getTime();
  const e = end.getTime();
  return (events ?? []).filter((ev) => {
    const ts = ev?.playedAt ?? ev?.played_at;
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return t >= s && t <= e;
  });
}

function summarize(eventsArr) {
  const tracks = new Map();
  const artists = new Map();
  const byDay = new Map();
  let totalMinutes = 0;

  for (const ev of eventsArr) {
    const ytId = ev.ytId ?? ev.yt_id ?? ev.id;
    const title = ev.title ?? '';
    const artist = ev.artist ?? null;
    const cover = ev.coverUrl ?? ev.cover_url ?? null;
    const playedSec = Number(ev.durationPlayedSeconds ?? ev.duration_played_seconds ?? 0);
    if (Number.isFinite(playedSec) && playedSec > 0) {
      totalMinutes += playedSec / 60;
    }
    if (ytId) {
      const key = ytId;
      const cur = tracks.get(key) ?? { ytId: key, title, artist, cover, count: 0 };
      cur.count += 1;
      tracks.set(key, cur);
    }
    if (artist) {
      artists.set(artist, (artists.get(artist) ?? 0) + 1);
    }
    const ts = ev.playedAt ?? ev.played_at;
    if (ts) {
      const d = new Date(ts);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      byDay.set(k, (byDay.get(k) ?? 0) + 1);
    }
  }

  const topTracks = Array.from(tracks.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const topArtists = Array.from(artists.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }));

  let topDay = null;
  let topDayCount = 0;
  for (const [k, v] of byDay) {
    if (v > topDayCount) {
      topDay = k;
      topDayCount = v;
    }
  }

  return {
    totalPlays: eventsArr.length,
    totalMinutes: Math.round(totalMinutes),
    topTracks,
    topArtists,
    topDay,
    topDayCount,
  };
}

function shouldAutoOpen() {
  const now = new Date();
  // Solo dispara despues del dia 2 del mes (da margen para historial sync).
  if (now.getDate() < 2) return null;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const key = monthKey(prev);
  try {
    if (localStorage.getItem(`ritmiq.wrapped-seen-${key}`) === '1') return null;
  } catch {
    return null;
  }
  return key;
}

function markSeen(key) {
  try { localStorage.setItem(`ritmiq.wrapped-seen-${key}`, '1'); } catch {}
}

/**
 * Componente auto-trigger. Se monta una vez en App.jsx; decide internamente
 * si abrir el modal segun el historial + localStorage flag.
 */
export function MonthlyWrappedAutoTrigger() {
  const events = useHistoryStore((s) => s.events);
  const [open, setOpen] = useState(false);
  const [seenKey, setSeenKey] = useState(null);

  // Decide al montar (y cuando events cambia por primera vez con datos).
  useEffect(() => {
    if (!events || events.length === 0) return;
    if (open || seenKey) return;
    const key = shouldAutoOpen();
    if (!key) return;
    setSeenKey(key);
    setOpen(true);
  }, [events, open, seenKey]);

  if (!open || !seenKey) return null;
  return (
    <MonthlyWrappedModal
      onClose={() => {
        markSeen(seenKey);
        setOpen(false);
      }}
    />
  );
}

/**
 * Modal stand-alone. Util para trigger manual desde StatsView en el futuro.
 */
export function MonthlyWrappedModal({ onClose }) {
  const events = useHistoryStore((s) => s.events);
  const playNow = usePlayerStore((s) => s.playNow);

  const { start, end } = useMemo(previousMonthRange, []);
  const monthLabel = `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;

  const eventsArr = useMemo(
    () => eventsInRange(events, start, end),
    [events, start, end],
  );
  const summary = useMemo(() => summarize(eventsArr), [eventsArr]);

  if (summary.totalPlays === 0) {
    return (
      <Modal onClose={onClose} title="Tu mes en Ritmiq" size="md">
        <p className={styles.empty}>
          No tenemos suficientes datos del mes anterior. Sigue escuchando y
          el proximo wrapped sera mas interesante.
        </p>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Tu mes en Ritmiq" size="md">
      <div className={styles.wrap}>
        <header className={styles.head}>
          <div className={styles.eyebrow}>
            <Icon name="Sparkles" size={14} />
            <span>Wrapped</span>
          </div>
          <h2 className={styles.title}>{monthLabel}</h2>
          <p className={styles.tagline}>
            <strong>{summary.totalPlays}</strong> reproducciones
            {summary.totalMinutes > 0 && (
              <>
                {' \u2022 '}
                <strong>{summary.totalMinutes}</strong> min escuchados
              </>
            )}
          </p>
        </header>

        {summary.topTracks.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Tus 3 canciones</h3>
            <ol className={styles.trackList}>
              {summary.topTracks.map((t, i) => (
                <li key={t.ytId} className={styles.trackRow}>
                  <span className={styles.rank}>{i + 1}</span>
                  <CoverArt
                    coverUrl={t.cover}
                    seed={t.title}
                    size={44}
                    radius="sm"
                  />
                  <div className={styles.trackMeta}>
                    <span className={styles.trackTitle}>{t.title}</span>
                    {t.artist && (
                      <span className={styles.trackArtist}>{t.artist}</span>
                    )}
                  </div>
                  <span className={styles.trackCount}>
                    {t.count} {t.count === 1 ? 'play' : 'plays'}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {summary.topArtists.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Tus 3 artistas</h3>
            <ol className={styles.artistList}>
              {summary.topArtists.map((a, i) => (
                <li key={a.name} className={styles.artistRow}>
                  <span className={styles.rank}>{i + 1}</span>
                  <span className={styles.artistName}>{a.name}</span>
                  <span className={styles.trackCount}>
                    {a.count} {a.count === 1 ? 'play' : 'plays'}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {summary.topDay && (
          <p className={styles.topDay}>
            Tu dia mas activo:{' '}
            <strong>
              {new Date(summary.topDay).toLocaleDateString(undefined, {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </strong>
            {' '}con {summary.topDayCount} plays.
          </p>
        )}
      </div>
    </Modal>
  );
}
