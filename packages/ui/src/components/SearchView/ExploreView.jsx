/**
 * Vista "Explorar" — empty state de SearchView cuando no hay query.
 *
 * Contiene:
 *  - Recomendaciones del dia (auto-genre-mix + discover del store).
 *  - Tus artistas top (del historial reciente).
 *  - Geneneros y estados de animo (hardcoded curados con gradientes).
 *
 * Click en un genero card → ejecuta search con ese termino.
 * Click en un artista → ArtistView.
 *
 * @module @ritmiq/ui/components/SearchView/ExploreView
 */
import { useEffect, useMemo } from 'react';
import { useRecommendationsStore } from '../../stores/recommendations.js';
import { useHistoryStore, selectTopArtists } from '../../stores/history.js';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { HomeRow } from '../Home/HomeRow.jsx';
import { TrackCard } from '../Home/TrackCard.jsx';
import { ArtistCard } from '../Home/ArtistCard.jsx';
import { Icon } from '../Icon/Icon.jsx';
import styles from './ExploreView.module.css';

/**
 * Lista curada de generos para v1. Cada uno con gradiente unico.
 * El click pasa el nombre como query del buscador.
 */
const GENRES = [
  { id: 'pop',         label: 'Pop',           gradient: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)' },
  { id: 'rock',        label: 'Rock',          gradient: 'linear-gradient(135deg, #dc2626 0%, #7f1d1d 100%)' },
  { id: 'indie',       label: 'Indie',         gradient: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)' },
  { id: 'hip-hop',     label: 'Hip-Hop',       gradient: 'linear-gradient(135deg, #8b5cf6 0%, #5b21b6 100%)' },
  { id: 'reggaeton',   label: 'Reggaetón',     gradient: 'linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)' },
  { id: 'electronica', label: 'Electrónica',   gradient: 'linear-gradient(135deg, #06b6d4 0%, #0e7490 100%)' },
  { id: 'jazz',        label: 'Jazz',          gradient: 'linear-gradient(135deg, #f97316 0%, #c2410c 100%)' },
  { id: 'salsa',       label: 'Salsa',         gradient: 'linear-gradient(135deg, #eab308 0%, #a16207 100%)' },
  { id: 'rnb',         label: 'R&B',           gradient: 'linear-gradient(135deg, #a855f7 0%, #6b21a8 100%)' },
  { id: 'soundtracks', label: 'Soundtracks',   gradient: 'linear-gradient(135deg, #475569 0%, #0f172a 100%)' },
  { id: 'acustico',    label: 'Acústico',      gradient: 'linear-gradient(135deg, #84cc16 0%, #4d7c0f 100%)' },
  { id: 'latin-pop',   label: 'Latin Pop',     gradient: 'linear-gradient(135deg, #f43f5e 0%, #be123c 100%)' },
  { id: 'metal',       label: 'Metal',         gradient: 'linear-gradient(135deg, #1e293b 0%, #020617 100%)' },
  { id: 'clasica',     label: 'Clásica',       gradient: 'linear-gradient(135deg, #c2410c 0%, #422006 100%)' },
];

export function ExploreView() {
  const events = useHistoryStore((s) => s.events);
  const recStore = useRecommendationsStore((s) => s.sections);
  const fetchRec = useRecommendationsStore((s) => s.fetch);
  const playNow = usePlayerStore((s) => s.playNow);
  const goArtist = useViewStore((s) => s.goArtist);
  const goSearch = useViewStore((s) => s.goSearch);

  const topArtists = useMemo(
    () => selectTopArtists(events, { days: 30, limit: 10 }),
    [events]
  );

  // Cargar recommendations al montar.
  useEffect(() => {
    fetchRec('auto-genre-mix', '').catch(() => {});
    if (topArtists.length >= 1) fetchRec('discover', '').catch(() => {});
  }, [topArtists.length, fetchRec]);

  const genreMix = recStore['auto-genre-mix:'];
  const discover = recStore['discover:'];

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Explorar</h1>
        <p className={styles.sub}>Descubre música nueva</p>
      </header>

      {/* Recomendaciones del dia */}
      {genreMix?.tracks?.length > 0 && (
        <HomeRow
          title="Recomendaciones del día"
          subtitle="Basadas en lo que más escuchas"
          items={genreMix.tracks}
          renderItem={(t, i) => (
            <TrackCard track={t} onClick={() => playNow(genreMix.tracks, i)} />
          )}
          onPlayAll={() => playNow(genreMix.tracks, 0)}
        />
      )}

      {/* Descubre nuevos artistas */}
      {discover?.tracks?.length > 0 && (
        <HomeRow
          title="Descubre nuevos artistas"
          subtitle="Artistas que aún no están en tu biblioteca"
          items={discover.tracks}
          renderItem={(t, i) => (
            <TrackCard track={t} onClick={() => playNow(discover.tracks, i)} />
          )}
          onPlayAll={() => playNow(discover.tracks, 0)}
        />
      )}

      {/* Tus artistas */}
      {topArtists.length > 0 && (
        <section className={styles.row}>
          <header className={styles.rowHead}>
            <h2 className={styles.rowTitle}>Tus artistas</h2>
          </header>
          <div className={styles.artistGrid}>
            {topArtists.slice(0, 8).map((a) => (
              <ArtistCard
                key={a.artist}
                entry={{ artist: a.artist, coverUrl: a.coverUrl, playCount: a.playCount }}
                onClick={() => goArtist(a.artist)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Géneros y estados de ánimo */}
      <section className={styles.row}>
        <header className={styles.rowHead}>
          <h2 className={styles.rowTitle}>Géneros y estados de ánimo</h2>
        </header>
        <div className={styles.genreGrid}>
          {GENRES.map((g) => (
            <button
              key={g.id}
              type="button"
              className={styles.genreCard}
              style={{ background: g.gradient }}
              onClick={() => goSearch(g.label)}
              aria-label={`Buscar ${g.label}`}
            >
              <span className={styles.genreLabel}>{g.label}</span>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
