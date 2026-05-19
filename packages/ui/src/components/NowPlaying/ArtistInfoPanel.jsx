/**
 * Panel "Acerca del artista" + "Explora [Artist]" debajo del NowPlaying.
 *
 * Reutiliza datos de useArtistStore (Edge artist-detail: Last.fm +
 * Innertube, cache server 24h + memoria). Solo fetcha cuando cambia
 * `currentTrack.artist`. Si el artista no tiene info, muestra fallback.
 *
 * Estructura:
 *   - Acerca del artista: hero image grande + nombre + bio (truncada).
 *   - Explora [Artist]: carrusel con canciones del artista (lib local) +
 *     similar artists (de Last.fm via artist-detail).
 *
 * @module @ritmiq/ui/components/NowPlaying/ArtistInfoPanel
 */
import { useEffect, useState } from 'react';
import { useArtistStore } from '../../stores/artist.js';
import { useLibraryStore } from '../../stores/library.js';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './ArtistInfoPanel.module.css';

/** @param {{ artistName: string }} props */
export function ArtistInfoPanel({ artistName }) {
  const fetchArtist = useArtistStore((s) => s.fetch);
  const details = useArtistStore((s) => s.details[artistName]);
  const tracks = useLibraryStore((s) => s.tracks);
  const playNow = usePlayerStore((s) => s.playNow);
  const goArtist = useViewStore((s) => s.goArtist);
  const closeNowPlaying = useViewStore((s) => s.closeNowPlaying);
  const [bioExpanded, setBioExpanded] = useState(false);

  useEffect(() => {
    if (artistName) fetchArtist(artistName);
  }, [artistName, fetchArtist]);

  if (!artistName) return null;

  // Canciones del artista presentes en la biblioteca del user.
  const artistTracks = tracks.filter(
    (t) => (t.artist ?? '').toLowerCase() === artistName.toLowerCase()
  );

  const onPlayFromLib = (idx) => {
    playNow(artistTracks, idx);
  };

  const onGoArtist = () => {
    closeNowPlaying();
    goArtist(artistName);
  };

  const loading = details?.loading;
  const heroImage = details?.heroImage ?? details?.image ?? artistTracks[0]?.coverUrl ?? null;
  const listeners = details?.listeners;
  const bio = details?.bio ?? '';
  const similar = details?.similar ?? [];

  return (
    <div className={styles.panel}>
      {/* Hero: imagen grande + nombre + listeners */}
      <section className={styles.heroSection}>
        <h2 className={styles.sectionTitle}>Acerca del artista</h2>
        <div className={styles.hero} style={heroImage ? { backgroundImage: `url(${heroImage})` } : undefined}>
          {!heroImage && <div className={styles.heroPlaceholder}><Icon name="User" size={48} /></div>}
          <div className={styles.heroOverlay}>
            <span className={styles.heroBadge}>Acerca del artista</span>
          </div>
        </div>
        <div className={styles.heroMeta}>
          <button type="button" className={styles.artistName} onClick={onGoArtist}>
            {artistName}
            <Icon name="ChevronRight" size={18} />
          </button>
          {listeners && (
            <p className={styles.listeners}>
              {formatListeners(listeners)} oyentes mensuales
            </p>
          )}
          {bio && (
            <div className={styles.bioBox}>
              <p className={styles.bio} data-expanded={bioExpanded}>{bio}</p>
              {bio.length > 240 && (
                <button
                  type="button"
                  className={styles.bioToggle}
                  onClick={() => setBioExpanded((v) => !v)}
                >
                  {bioExpanded ? 'ver menos' : 'ver más'}
                </button>
              )}
            </div>
          )}
          {loading && <p className={styles.muted}>Cargando información...</p>}
          {!loading && !bio && !listeners && (
            <p className={styles.muted}>
              Sin información disponible para este artista.
            </p>
          )}
        </div>
      </section>

      {/* Tus canciones del artista */}
      {artistTracks.length > 0 && (
        <section className={styles.exploreSection}>
          <h2 className={styles.sectionTitle}>Tus canciones de {artistName}</h2>
          <div className={styles.carousel}>
            {artistTracks.slice(0, 10).map((t, i) => (
              <button
                key={t.id}
                type="button"
                className={styles.card}
                onClick={() => onPlayFromLib(i)}
              >
                <div className={styles.cardCover}>
                  {t.coverUrl
                    ? <img src={t.coverUrl} alt="" loading="lazy" />
                    : <Icon name="Music" size={28} />
                  }
                  <span className={styles.cardPlayOverlay} aria-hidden="true">
                    <Icon name="Play" size={20} filled />
                  </span>
                </div>
                <span className={styles.cardTitle}>{t.title}</span>
                <span className={styles.cardSub}>{t.album ?? t.artist}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Artistas similares */}
      {similar.length > 0 && (
        <section className={styles.exploreSection}>
          <h2 className={styles.sectionTitle}>Similar a {artistName}</h2>
          <div className={styles.carousel}>
            {similar.slice(0, 10).map((a) => (
              <button
                key={a.name}
                type="button"
                className={styles.card}
                onClick={() => { closeNowPlaying(); goArtist(a.name); }}
              >
                <div className={styles.cardCover} data-circle="true">
                  {a.image
                    ? <img src={a.image} alt="" loading="lazy" />
                    : <Icon name="User" size={28} />
                  }
                </div>
                <span className={styles.cardTitle}>{a.name}</span>
                <span className={styles.cardSub}>Artista</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function formatListeners(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return n;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)} M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)} K`;
  return String(num);
}
