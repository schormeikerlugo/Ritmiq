/**
 * Card vertical para un track en Home (carrusel horizontal).
 * Cover cuadrado + título + subtítulo + botón play overlay en hover.
 */
import { Icon } from '../Icon/Icon.jsx';
import { CoverArt } from '../primitives/CoverArt.jsx';
import styles from './TrackCard.module.css';

export function TrackCard({ track, subtitle, onClick }) {
  if (!track) return null;
  return (
    <button
      type="button"
      className={styles.card}
      onClick={onClick}
      aria-label={`Reproducir ${track.title}`}
    >
      <div className={styles.coverWrap}>
        <CoverArt
          coverUrl={track.coverUrl}
          seed={track.title || track.artist || ''}
          radius="sm"
          className={styles.cover}
        />
        <span className={styles.playBtn} aria-hidden="true">
          <Icon name="Play" size={18} filled />
        </span>
      </div>
      <div className={styles.meta}>
        <span className={styles.title}>{track.title}</span>
        <span className={styles.sub}>{subtitle ?? track.artist ?? ''}</span>
      </div>
    </button>
  );
}
