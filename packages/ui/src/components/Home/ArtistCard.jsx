/**
 * Card circular para un artista en el carrusel "Tus artistas".
 */
import { Icon } from '../Icon/Icon.jsx';
import styles from './ArtistCard.module.css';

export function ArtistCard({ entry, onClick }) {
  if (!entry) return null;
  return (
    <button
      type="button"
      className={styles.card}
      onClick={onClick}
      aria-label={`Reproducir mix de ${entry.artist}`}
    >
      <div className={styles.coverWrap}>
        {entry.coverUrl
          ? <img className={styles.cover} src={entry.coverUrl} alt="" loading="lazy" />
          : <div className={styles.fallback}><Icon name="User" size={32} /></div>}
        <span className={styles.playBtn} aria-hidden="true">
          <Icon name="Play" size={16} filled />
        </span>
      </div>
      <div className={styles.meta}>
        <span className={styles.title}>{entry.artist}</span>
        <span className={styles.sub}>Artista · {entry.playCount} {entry.playCount === 1 ? 'play' : 'plays'}</span>
      </div>
    </button>
  );
}
