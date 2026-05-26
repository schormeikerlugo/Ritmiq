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
import { checkSharedCache, prewarmStream } from '../../lib/lan-client.js';
import { isDesktop } from '../../lib/api.js';
import { Icon } from '../Icon/Icon.jsx';
import { TrackCard } from '../Home/TrackCard.jsx';
import { ArtistCard } from '../Home/ArtistCard.jsx';
import { RowSkeleton } from '../Home/RowSkeleton.jsx';
import { ExploreView } from './ExploreView.jsx';
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
  const known     = useSearchStore((s) => s.known);
  const loading   = useSearchStore((s) => s.loading);
  const error     = useSearchStore((s) => s.error);
  const playNow   = usePlayerStore((s) => s.playNow);
  const goArtist  = useViewStore((s) => s.goArtist);
  const goSearch  = useViewStore((s) => s.goSearch);
  const libraryTracks = useLibraryStore((s) => s.tracks);

  const [tab, setTab] = useState('all');
  const [cachedSet, setCachedSet] = useState(/** @type {Set<string>} */ (new Set()));
  const [inputValue, setInputValue] = useState(query ?? '');

  useEffect(() => { setInputValue(query ?? ''); }, [query]);

  useEffect(() => {
    if (query) fetchAll(query);
  }, [query, fetchAll]);

  // Submit del input mobile: lanza goSearch (que pushea a history view stack
  // y dispara fetchAll en el useEffect siguiente).
  const onSubmitSearch = (e) => {
    e.preventDefault();
    const q = inputValue.trim();
    if (q && q !== query) goSearch(q);
  };

  // En mobile cuando no hay query, mostramos ExploreView (Explorar).
  // Mantenemos el input arriba para que el user pueda escribir.
  const showExplore = !query;

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

  // ── Conocidas en Ritmiq ────────────────────────────────────────────
  // El Edge search-youtube devuelve un array `known` con tracks que
  // alguien en la red Ritmiq ya canonizo en tracks_global. Los
  // convertimos a Track reproducibles y los deduplicamos contra
  // localMatches (lo tuyo gana). Tambien construimos un Set de ytIds
  // conocidos para marcar con badge los videos de Innertube que ya
  // existen en el diccionario global.
  const localYtIds = useMemo(() => {
    const s = new Set();
    for (const t of localMatches) if (t.ytId) s.add(t.ytId);
    return s;
  }, [localMatches]);

  const knownAsTracks = useMemo(() => {
    if (!Array.isArray(known) || known.length === 0) return [];
    return known
      .filter((k) => k.ytId && !localYtIds.has(k.ytId))
      .map((k) => metaToCandidate({
        id: k.ytId,
        title: k.title,
        uploader: k.artist,
        duration: k.durationSeconds ?? null,
        thumbnail: k.coverUrl ?? null,
      }));
  }, [known, localYtIds]);

  const knownYtIds = useMemo(() => {
    const s = new Set();
    for (const k of known) if (k.ytId) s.add(k.ytId);
    return s;
  }, [known]);

  const knownCountByYtId = useMemo(() => {
    const m = new Map();
    for (const k of known) if (k.ytId) m.set(k.ytId, k.contributionCount ?? 0);
    return m;
  }, [known]);

  /** Convierte videos del search en Tracks reproducibles, dedupeando
   *  contra los que ya estan en la biblioteca local Y contra los
   *  conocidos en Ritmiq (mismo ytId), y ordenando para que los
   *  cacheados en el desktop (⚡) aparezcan primero. Sort estable:
   *  preserva el orden original dentro de cada grupo (cached, no-cached).
   *
   *  Los `known` se renderizan en su propia franja arriba — no queremos
   *  duplicarlos dentro del listado de YouTube. */
  const videosAsTracks = useMemo(() => {
    const filteredLocal = dedupeByYtId(videos, localMatches);
    const filtered = filteredLocal.filter((v) => !knownYtIds.has(v.id));
    const tracks = filtered.map((v) => metaToCandidate({
      id: v.id,
      title: v.title,
      uploader: v.uploader ?? null,
      duration: v.duration ?? null,
      thumbnail: v.thumbnail ?? null,
    }));
    if (cachedSet.size === 0) return tracks;
    const cached = [];
    const others = [];
    for (const t of tracks) {
      if (t.ytId && cachedSet.has(t.ytId)) cached.push(t);
      else others.push(t);
    }
    return [...cached, ...others];
  }, [videos, localMatches, knownYtIds, cachedSet]);

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

  const playKnown = (idx) => {
    if (knownAsTracks.length === 0) return;
    const clamped = Math.min(idx, knownAsTracks.length - 1);
    playNow(knownAsTracks, clamped);
  };

  const noResults = !loading
    && videos.length === 0
    && channels.length === 0
    && playlists.length === 0
    && localMatches.length === 0
    && knownAsTracks.length === 0;

  return (
    <section className={styles.wrap}>
      {/* Input de busqueda — visible siempre en mobile, oculto en desktop
          (desktop tiene el input arriba en TopBar). */}
      <form className={styles.searchForm} onSubmit={onSubmitSearch}>
        <Icon name="Search" size={18} />
        <input
          type="search"
          className={styles.searchInput}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="¿Qué quieres escuchar?"
          autoComplete="off"
        />
        {inputValue && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => { setInputValue(''); if (query) useViewStore.getState().goSearchView(); }}
            aria-label="Limpiar"
          ><Icon name="X" size={16} /></button>
        )}
      </form>

      {showExplore ? (
        <ExploreView />
      ) : (
        <SearchResults
          query={query}
          tab={tab}
          setTab={setTab}
          videos={videos}
          channels={channels}
          playlists={playlists}
          loading={loading}
          error={error}
          localMatches={localMatches}
          videosAsTracks={videosAsTracks}
          knownAsTracks={knownAsTracks}
          knownCountByYtId={knownCountByYtId}
          cachedSet={cachedSet}
          noResults={noResults}
          playLocal={playLocal}
          playSongList={playSongList}
          playKnown={playKnown}
          goArtist={goArtist}
        />
      )}
    </section>
  );
}

function SearchResults({
  query, tab, setTab,
  videos, channels, playlists, loading, error,
  localMatches, videosAsTracks, knownAsTracks, knownCountByYtId,
  cachedSet, noResults, playLocal, playSongList, playKnown, goArtist,
}) {
  return (
    <>
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

          {/* Conocidas en Ritmiq: la franja P2P. Tracks canonizados por
              la red. Aparecen ENTRE tu biblioteca y los resultados de
              YouTube — mas confiables que un resultado random fresco. */}
          {knownAsTracks.length > 0 && (
            <section className={styles.row}>
              <header className={styles.rowHead}>
                <h2 className={styles.rowTitle}>
                  <Icon name="Sparkles" size={14} />
                  {' '}Conocidas en Ritmiq
                </h2>
              </header>
              <div className={styles.songList}>
                {knownAsTracks.slice(0, 5).map((t, i) => (
                  <SongRow
                    key={`known-${t.id}`}
                    track={t}
                    onClick={() => playKnown(i)}
                    cached={t.ytId ? cachedSet.has(t.ytId) : false}
                    knownCount={knownCountByYtId.get(t.ytId) ?? 0}
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
                    entry={{
                      artist: c.title,
                      coverUrl: c.thumbnail,
                      verified: c.verified,
                      isTopic: c.isTopic,
                    }}
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
          {/* Conocidas primero (P2P trust) → luego YouTube fresco. */}
          {knownAsTracks.map((t, i) => (
            <SongRow
              key={`known-${t.id}`}
              track={t}
              onClick={() => playKnown(i)}
              cached={t.ytId ? cachedSet.has(t.ytId) : false}
              knownCount={knownCountByYtId.get(t.ytId) ?? 0}
            />
          ))}
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
              entry={{
                artist: c.title,
                coverUrl: c.thumbnail,
                verified: c.verified,
                isTopic: c.isTopic,
              }}
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
    </>
  );
}

/** Fila tipo Spotify para canciones individuales en el tab "Todo" / "Canciones".
 *  @param {{ track:any, onClick:()=>void, badge?:string, cached?:boolean, knownCount?:number }} props */
function SongRow({ track, onClick, badge, cached, knownCount }) {
  const knownLabel = knownCount > 1
    ? `✨ ${knownCount} en Ritmiq`
    : knownCount === 1
      ? `✨ Nueva en Ritmiq`
      : null;
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
          {knownLabel && (
            <span
              className={styles.songKnownBadge}
              title={`Canonicalizada en la red Ritmiq · ${knownCount} ${knownCount === 1 ? 'reproduccion' : 'reproducciones'} acumuladas`}
            >{knownLabel}</span>
          )}
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
