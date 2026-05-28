/**
 * HistoryView \u2014 lista completa de play_history del usuario con search +
 * filtros de fecha y artista.
 *
 * Datos: useHistoryStore.events (ya cargados al login).
 *
 * Filtros:
 *   - search: matchea title o artist (case-insensitive, substring).
 *   - dateRange: 'all' | 'today' | 'week' | 'month' | 'year'.
 *   - artistFilter: nombre exacto (autocompletado simple: dropdown de
 *     artistas presentes en events). 'all' = sin filtrar.
 *
 * Click en row \u2192 reproduce ese track + carga el resto del historial
 * filtrado como cola.
 *
 * @module @ritmiq/ui/components/HistoryView
 */
import { useMemo, useState } from 'react';
import { useHistoryStore } from '../../stores/history.js';
import { usePlayerStore } from '../../stores/player.js';
import { Icon } from '../Icon/Icon.jsx';
import { CoverArt } from '../primitives/CoverArt.jsx';
import { EmptyState } from '../primitives/EmptyState.jsx';
import styles from './HistoryView.module.css';

const DATE_RANGES = [
  { id: 'all',   label: 'Todo' },
  { id: 'today', label: 'Hoy' },
  { id: 'week',  label: '7 dias' },
  { id: 'month', label: '30 dias' },
  { id: 'year',  label: '1 ano' },
];

function rangeStartMs(rangeId) {
  const now = Date.now();
  switch (rangeId) {
    case 'today': {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case 'week':  return now - 7 * 86400_000;
    case 'month': return now - 30 * 86400_000;
    case 'year':  return now - 365 * 86400_000;
    default:      return 0;
  }
}

function formatRelative(ts) {
  const d = Date.now() - new Date(ts).getTime();
  if (d < 60_000)     return 'ahora';
  if (d < 3_600_000)  return `hace ${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `hace ${Math.floor(d / 3_600_000)} h`;
  if (d < 7 * 86_400_000) return `hace ${Math.floor(d / 86_400_000)} d`;
  // Mayor a 1 semana: fecha absoluta corta.
  const date = new Date(ts);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function eventToTrack(ev) {
  return {
    id: ev.trackId ?? (ev.ytId ? `yt:${ev.ytId}` : `hist:${ev.playedAt}`),
    userId: '',
    source: ev.source ?? 'youtube',
    ytId: ev.ytId ?? null,
    title: ev.title ?? '',
    artist: ev.artist ?? null,
    album: null,
    durationSeconds: ev.durationSeconds ?? null,
    coverUrl: ev.coverUrl ?? null,
    filePath: null,
    isDownloaded: false,
    createdAt: ev.playedAt,
  };
}

export function HistoryView() {
  const events = useHistoryStore((s) => s.events);
  const playNow = usePlayerStore((s) => s.playNow);

  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [artistFilter, setArtistFilter] = useState('all');

  // Lista de artistas unicos para el dropdown.
  const artistOptions = useMemo(() => {
    const set = new Set();
    for (const e of events) {
      if (e?.artist) set.add(e.artist);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [events]);

  // Filtrado.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minMs = rangeStartMs(dateRange);
    return events.filter((ev) => {
      if (artistFilter !== 'all' && ev.artist !== artistFilter) return false;
      if (minMs > 0) {
        const t = new Date(ev.playedAt).getTime();
        if (!Number.isFinite(t) || t < minMs) return false;
      }
      if (q) {
        const title = (ev.title ?? '').toLowerCase();
        const artist = (ev.artist ?? '').toLowerCase();
        if (!title.includes(q) && !artist.includes(q)) return false;
      }
      return true;
    });
  }, [events, search, dateRange, artistFilter]);

  const handleClick = (idx) => {
    const tracks = filtered.map(eventToTrack);
    if (tracks.length === 0) return;
    playNow(tracks, idx);
  };

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Historial</h1>
        <p className={styles.subtitle}>
          Tus {events.length} reproducciones mas recientes. Busca y filtra.
        </p>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Icon name="Search" size={16} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Buscar por titulo o artista..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className={styles.clearBtn}
              onClick={() => setSearch('')}
              aria-label="Limpiar busqueda"
            >
              <Icon name="X" size={14} />
            </button>
          )}
        </div>

        <div className={styles.filters}>
          <div className={styles.dateTabs} role="tablist" aria-label="Rango de fechas">
            {DATE_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={dateRange === r.id}
                data-active={dateRange === r.id}
                className={styles.dateTab}
                onClick={() => setDateRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <select
            className={styles.artistSelect}
            value={artistFilter}
            onChange={(e) => setArtistFilter(e.target.value)}
            aria-label="Filtrar por artista"
          >
            <option value="all">Todos los artistas</option>
            {artistOptions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="Search"
          title="Sin resultados"
          subtitle={
            search
              ? `No encontramos nada para "${search}" en ${dateRange === 'all' ? 'tu historial' : `los ultimos ${DATE_RANGES.find((r) => r.id === dateRange)?.label}`}.`
              : 'Cambia los filtros o empieza a escuchar musica para llenar tu historial.'
          }
        />
      ) : (
        <ol className={styles.list}>
          {filtered.map((ev, i) => (
            <li key={`${ev.playedAt}-${i}`} className={styles.row}>
              <button
                type="button"
                className={styles.rowBtn}
                onClick={() => handleClick(i)}
              >
                <CoverArt
                  coverUrl={ev.coverUrl}
                  seed={ev.title || ev.artist || 'ritmiq'}
                  size={44}
                  radius="sm"
                />
                <div className={styles.meta}>
                  <span className={styles.rowTitle}>{ev.title || '(sin titulo)'}</span>
                  <span className={styles.rowArtist}>{ev.artist ?? '—'}</span>
                </div>
                <span className={styles.rowDate}>{formatRelative(ev.playedAt)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
