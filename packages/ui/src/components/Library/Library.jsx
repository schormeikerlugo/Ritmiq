import { useEffect, useState } from 'react';
import { useLibraryStore } from '../../stores/library.js';
import { usePlayerStore } from '../../stores/player.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { DropdownMenu } from '../DropdownMenu/DropdownMenu.jsx';
import { TrackInfoDialog } from '../TrackInfoDialog/TrackInfoDialog.jsx';
import { SaveDialog } from '../SaveDialog/SaveDialog.jsx';
import { isDesktop } from '../../lib/api.js';
import styles from './Library.module.css';

function fmtDur(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

export function Library() {
  const { tracks, loading, error, load, download, undownload, remove } = useLibraryStore();
  const playNow = usePlayerStore((s) => s.playNow);
  const playNext = usePlayerStore((s) => s.playNext);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const toggleFavorite = usePlaylistsStore((s) => s.toggleFavorite);
  const isFavorite = usePlaylistsStore((s) => s.isFavorite);
  const [infoTrack, setInfoTrack] = useState(null);
  const [saveTrack, setSaveTrack] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => { load(); }, [load]);

  if (loading && tracks.length === 0) {
    return (
      <section className={styles.wrap}>
        <p className={styles.muted}>Cargando biblioteca…</p>
      </section>
    );
  }

  if (tracks.length === 0) {
    return (
      <section className={styles.wrap}>
        <header className={styles.header}>
          <h1 className={styles.title}>Tu biblioteca</h1>
          <p className={styles.subtitle}>
            Aún no hay canciones. Pega una URL de YouTube en la búsqueda para añadir tu primera.
          </p>
        </header>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>♫</div>
          <p>Tu música aparecerá aquí.</p>
        </div>
      </section>
    );
  }

  const q = filter.trim().toLowerCase();
  const filteredTracks = q
    ? tracks.filter((t) =>
        (t.title ?? '').toLowerCase().includes(q) ||
        (t.artist ?? '').toLowerCase().includes(q) ||
        (t.album ?? '').toLowerCase().includes(q))
    : tracks;

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Tu biblioteca</h1>
        <p className={styles.subtitle}>{tracks.length} canciones</p>
      </header>

      <div className={styles.toolbar}>
        <input
          className={styles.filter}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por título, artista o álbum…"
        />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <ul className={styles.list}>
        {filteredTracks.map((t, i) => {
          const playing = currentTrack?.id === t.id;
          const fav = isFavorite(t.id);
          const trackMenu = [
            { id: 'next', label: 'Reproducir a continuación', icon: '⤵', onClick: () => playNext(t) },
            { id: 'q', label: 'Añadir a la cola', icon: '☰', onClick: () => enqueue(t) },
            { separator: true },
            {
              id: 'fav',
              label: fav ? 'Quitar de favoritos' : 'Añadir a favoritos',
              icon: fav ? '♥' : '♡',
              onClick: () => toggleFavorite(t.id),
            },
            {
              id: 'addto', label: 'Añadir a otra playlist…', icon: '＋',
              onClick: () => setSaveTrack(t),
            },
            { separator: true },
            {
              id: 'dl',
              label: t.isDownloaded ? 'Quitar descarga' : 'Descargar',
              icon: t.isDownloaded ? '✕' : '↓',
              disabled: !isDesktop,
              onClick: () => t.isDownloaded ? undownload(t.id) : download(t.id),
            },
            { id: 'info', label: 'Mostrar info', icon: 'ⓘ', onClick: () => setInfoTrack(t) },
            { separator: true },
            {
              id: 'remove',
              label: 'Quitar de biblioteca',
              icon: '🗑',
              danger: true,
              onClick: () => {
                if (confirm(`¿Quitar "${t.title}" de la biblioteca?`)) remove(t.id);
              },
            },
          ];

          return (
            <li key={t.id} className={styles.row} data-playing={playing}>
              <button
                className={styles.cell}
                onClick={() => playNow(filteredTracks, i)}
                aria-label={`Reproducir ${t.title}`}
              >
                <div className={styles.cover}>
                  {t.coverUrl
                    ? <img src={t.coverUrl} alt="" />
                    : <span aria-hidden="true">♫</span>}
                </div>
                <div className={styles.meta}>
                  <span className={styles.rowTitle}>{t.title}</span>
                  <span className={styles.rowArtist}>{t.artist ?? '—'}</span>
                </div>
              </button>
              <span className={styles.dlIndicator}>
                {t.isDownloaded ? <span className={styles.dlOk} title="Descargada">●</span> : null}
              </span>
              <span className={styles.dur}>{fmtDur(t.durationSeconds)}</span>
              <DropdownMenu trigger="⋯" items={trackMenu} align="right" label="Opciones" />
            </li>
          );
        })}
      </ul>

      {infoTrack && (
        <TrackInfoDialog track={infoTrack} onClose={() => setInfoTrack(null)} />
      )}
      {saveTrack && (
        <SaveDialog track={saveTrack} onClose={() => setSaveTrack(null)} />
      )}
    </section>
  );
}
