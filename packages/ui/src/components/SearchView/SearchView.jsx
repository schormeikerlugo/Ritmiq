/**
 * Vista de búsqueda avanzada estilo Spotify.
 *
 * Tabs: Todo · Canciones · Artistas · Playlists
 * - Tab "Todo": 5 items de cada tipo (top result + grupos).
 * - Tabs específicos: hasta 20 items del tipo seleccionado.
 *
 * Click en canción → reproduce + carga grupo como cola.
 * Click en artista → navega a `goArtist(name)`.
 * Click en playlist → por ahora no implementado (Fase B).
 */
import { useEffect, useState } from 'react';
import { useSearchStore } from '../../stores/search.js';
import { useViewStore } from '../../stores/view.js';
import { usePlayerStore } from '../../stores/player.js';
import { metaToCandidate } from '../../lib/track-helpers.js';
import { Icon } from '../Icon/Icon.jsx';
import { TrackCard } from '../Home/TrackCard.jsx';
import { ArtistCard } from '../Home/ArtistCard.jsx';
import { RowSkeleton } from '../Home/RowSkeleton.jsx';
import styles from './SearchView.module.css';

const TABS = [
  { id: 'all',       label: 'Todo' },
  { id: 'videos',    label: 'Canciones' },
  { id: 'channels',  label: 'Artistas' },
  { id: 'playlists', label: 'Playlists' },
];

export function SearchView({ query }) {
  const fetchAll  = useSearchStore((s) => s.fetch);
  const videos    = useSearchStore((s) => s.videos);
  const channels  = useSearchStore((s) => s.channels);
  const playlists = useSearchStore((s) => s.playlists);
  const loading   = useSearchStore((s) => s.loading);
  const error     = useSearchStore((s) => s.error);
  const playNow   = usePlayerStore((s) => s.playNow);
  const goArtist  = useViewStore((s) => s.goArtist);

  const [tab, setTab] = useState('all');

  useEffect(() => {
    if (query) fetchAll(query);
  }, [query, fetchAll]);

  /** Convierte videos del search en Tracks reproducibles. */
  const videosAsTracks = videos.map((v) => metaToCandidate({
    id: v.id,
    title: v.title,
    uploader: v.uploader ?? null,
    duration: v.duration ?? null,
    thumbnail: v.thumbnail ?? null,
  }));

  const playSongList = (startIdx = 0) => {
    if (videosAsTracks.length === 0) return;
    const clamped = Math.min(startIdx, videosAsTracks.length - 1);
    playNow(videosAsTracks, clamped);
  };

  const noResults = !loading && videos.length === 0 && channels.length === 0 && playlists.length === 0;

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.query}>“{query}”</h1>
        <p className={styles.sub}>Resultados de búsqueda</p>
      </header>

      <nav className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? styles.tabActive : styles.tab}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </nav>

      {error && <p className={styles.error}>{error}</p>}

      {/* ── Tab: Todo ────────────────────────────────────────────────── */}
      {tab === 'all' && (
        <div className={styles.sections}>
          {loading && videos.length === 0 && (
            <>
              <RowSkeleton title="Canciones" count={4} />
              <RowSkeleton title="Artistas"   count={5} />
              <RowSkeleton title="Playlists"  count={4} />
            </>
          )}

          {!loading && videos.length > 0 && (
            <section className={styles.row}>
              <header className={styles.rowHead}>
                <h2 className={styles.rowTitle}>Canciones</h2>
                <button className={styles.seeMore} onClick={() => setTab('videos')}>
                  Ver todo
                </button>
              </header>
              <div className={styles.songList}>
                {videosAsTracks.slice(0, 5).map((t, i) => (
                  <SongRow
                    key={t.id}
                    track={t}
                    onClick={() => playSongList(i)}
                  />
                ))}
              </div>
            </section>
          )}

          {channels.length > 0 && (
            <section className={styles.row}>
              <header className={styles.rowHead}>
                <h2 className={styles.rowTitle}>Artistas</h2>
                <button className={styles.seeMore} onClick={() => setTab('channels')}>
                  Ver todo
                </button>
              </header>
              <div className={styles.cardGrid}>
                {channels.slice(0, 5).map((c) => (
                  <ArtistCard
                    key={c.id}
                    entry={{ artist: c.title, coverUrl: c.thumbnail, playCount: 0 }}
                    onClick={() => goArtist(c.title)}
                  />
                ))}
              </div>
            </section>
          )}

          {playlists.length > 0 && (
            <section className={styles.row}>
              <header className={styles.rowHead}>
                <h2 className={styles.rowTitle}>Playlists</h2>
                <button className={styles.seeMore} onClick={() => setTab('playlists')}>
                  Ver todo
                </button>
              </header>
              <div className={styles.cardGrid}>
                {playlists.slice(0, 5).map((p) => (
                  <TrackCard
                    key={p.id}
                    track={{
                      id: `pl:${p.id}`,
                      title: p.title,
                      artist: p.author,
                      coverUrl: p.thumbnail,
                    }}
                    subtitle={p.author ?? 'Playlist'}
                    onClick={() => {
                      // TODO: en Fase B abrimos la playlist completa.
                      console.info('[search] playlist click', p.id);
                    }}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── Tab: Canciones ───────────────────────────────────────────── */}
      {tab === 'videos' && (
        <div className={styles.songList}>
          {loading && videos.length === 0 && <RowSkeleton title="" count={6} />}
          {videosAsTracks.map((t, i) => (
            <SongRow
              key={t.id}
              track={t}
              onClick={() => playSongList(i)}
            />
          ))}
        </div>
      )}

      {/* ── Tab: Artistas ────────────────────────────────────────────── */}
      {tab === 'channels' && (
        <div className={styles.cardGrid}>
          {loading && channels.length === 0 && <RowSkeleton title="" count={8} />}
          {channels.map((c) => (
            <ArtistCard
              key={c.id}
              entry={{ artist: c.title, coverUrl: c.thumbnail, playCount: 0 }}
              onClick={() => goArtist(c.title)}
            />
          ))}
        </div>
      )}

      {/* ── Tab: Playlists ───────────────────────────────────────────── */}
      {tab === 'playlists' && (
        <div className={styles.cardGrid}>
          {loading && playlists.length === 0 && <RowSkeleton title="" count={6} />}
          {playlists.map((p) => (
            <TrackCard
              key={p.id}
              track={{
                id: `pl:${p.id}`,
                title: p.title,
                artist: p.author,
                coverUrl: p.thumbnail,
              }}
              subtitle={p.author ?? 'Playlist'}
              onClick={() => console.info('[search] playlist click', p.id)}
            />
          ))}
        </div>
      )}

      {noResults && (
        <div className={styles.empty}>
          <Icon name="Search" size={32} />
          <p>No encontramos resultados para “{query}”.</p>
        </div>
      )}
    </section>
  );
}

/** Fila tipo Spotify para canciones individuales en el tab "Todo" / "Canciones". */
function SongRow({ track, onClick }) {
  return (
    <button type="button" className={styles.songRow} onClick={onClick}>
      <div className={styles.songCover}>
        {track.coverUrl
          ? <img src={track.coverUrl} alt="" loading="lazy" />
          : <Icon name="Music" size={18} />}
        <span className={styles.songPlay} aria-hidden="true">
          <Icon name="Play" size={14} filled />
        </span>
      </div>
      <div className={styles.songMeta}>
        <span className={styles.songTitle}>{track.title}</span>
        <span className={styles.songSub}>
          Canción{track.artist ? ` · ${track.artist}` : ''}
        </span>
      </div>
      {track.durationSeconds && (
        <span className={styles.songDur}>{fmtDur(track.durationSeconds)}</span>
      )}
    </button>
  );
}

function fmtDur(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}
