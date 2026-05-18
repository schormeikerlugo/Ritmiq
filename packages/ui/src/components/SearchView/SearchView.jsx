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
import { useEffect, useMemo, useState } from 'react';
import { useSearchStore } from '../../stores/search.js';
import { useLibraryStore } from '../../stores/library.js';
import { useViewStore } from '../../stores/view.js';
import { usePlayerStore } from '../../stores/player.js';
import { metaToCandidate } from '../../lib/track-helpers.js';
import { searchLibraryTracks, dedupeByYtId } from '../../lib/library-search.js';
import { checkSharedCache } from '../../lib/lan-client.js';
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
  const libraryTracks = useLibraryStore((s) => s.tracks);

  const [tab, setTab] = useState('all');
  const [cachedSet, setCachedSet] = useState(/** @type {Set<string>} */ (new Set()));

  useEffect(() => {
    if (query) fetchAll(query);
  }, [query, fetchAll]);

  // Tras llegar videos, chequear cuales estan en cache compartido del PC
  // para mostrar el badge ⚡ "instant-play" a lo largo de la vista.
  useEffect(() => {
    if (!videos || videos.length === 0) {
      setCachedSet(new Set());
      return;
    }
    let cancelled = false;
    checkSharedCache(videos.map((v) => v.id))
      .then((set) => { if (!cancelled) setCachedSet(set); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [videos]);

  // Local-first: matches contra la biblioteca propia (max 5). Memoizado
  // por (query, libraryTracks) para no recomputar en cada render del tab.
  const localMatches = useMemo(
    () => searchLibraryTracks(libraryTracks, query, 5),
    [libraryTracks, query]
  );

  /** Convierte videos del search en Tracks reproducibles, dedupeando
   *  contra los que ya estan en la biblioteca local (mismo ytId). */
  const videosAsTracks = useMemo(() => {
    const filtered = dedupeByYtId(videos, localMatches);
    return filtered.map((v) => metaToCandidate({
      id: v.id,
      title: v.title,
      uploader: v.uploader ?? null,
      duration: v.duration ?? null,
      thumbnail: v.thumbnail ?? null,
    }));
  }, [videos, localMatches]);

  const playSongList = (startIdx = 0) => {
    if (videosAsTracks.length === 0) return;
    const clamped = Math.min(startIdx, videosAsTracks.length - 1);
    playNow(videosAsTracks, clamped);
  };

  const playLocal = (idx) => {
    if (localMatches.length === 0) return;
    const clamped = Math.min(idx, localMatches.length - 1);
    playNow(localMatches, clamped);
  };

  const noResults = !loading
    && videos.length === 0
    && channels.length === 0
    && playlists.length === 0
    && localMatches.length === 0;

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
          {/* En tu biblioteca: arriba de todo. Cero round-trip, instant. */}
          {localMatches.length > 0 && (
            <section className={styles.row}>
              <header className={styles.rowHead}>
                <h2 className={styles.rowTitle}>
                  <Icon name="Heart" size={14} filled />
                  {' '}En tu biblioteca
                </h2>
              </header>
              <div className={styles.songList}>
                {localMatches.map((t, i) => (
                  <SongRow
                    key={`local-${t.id}`}
                    track={t}
                    onClick={() => playLocal(i)}
                    badge={t.isDownloaded ? 'Descargada' : 'Tuya'}
                  />
                ))}
              </div>
            </section>
          )}

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
                    cached={t.ytId ? cachedSet.has(t.ytId) : false}
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
              cached={t.ytId ? cachedSet.has(t.ytId) : false}
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

/** Fila tipo Spotify para canciones individuales en el tab "Todo" / "Canciones".
 *  @param {{ track:any, onClick:()=>void, badge?:string, cached?:boolean }} props */
function SongRow({ track, onClick, badge, cached }) {
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
        <span className={styles.songTitle}>
          {track.title}
          {badge && <span className={styles.songBadge}>{badge}</span>}
          {cached && (
            <span
              className={styles.songCacheBadge}
              title="En cache del PC — reproduccion instantanea"
            >⚡ Caché</span>
          )}
        </span>
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
