/**
 * Card circular para un artista en el carrusel "Tus artistas" y resultados
 * de busqueda en SearchView.
 *
 * Si `entry.verified === true`, muestra un checkmark azul sobre el avatar
 * (badge "Official Artist Channel" de YouTube). Si `entry.isTopic === true`,
 * muestra una nota musical pequena indicando que es un canal auto-gen de
 * YT Music (catalogo licenciado del sello, no canal oficial humano).
 *
 * Cuando hay `entry.playCount` numerico, muestra "Artista · N plays".
 * Si NO viene playCount (busqueda YouTube sin historial), muestra etiqueta
 * adaptada: "Canal oficial" / "YouTube Music" / "Artista".
 */
import { Icon } from '../Icon/Icon.jsx';
import styles from './ArtistCard.module.css';

function subtitleFor(entry) {
  if (typeof entry.playCount === 'number') {
    return `Artista · ${entry.playCount} ${entry.playCount === 1 ? 'play' : 'plays'}`;
  }
  if (entry.verified) return 'Canal oficial';
  if (entry.isTopic)  return 'YouTube Music';
  return 'Artista';
}

export function ArtistCard({ entry, onClick }) {
  if (!entry) return null;
  return (
    <button
      type="button"
      className={styles.card}
      onClick={onClick}
      aria-label={
        entry.verified
          ? `Abrir canal oficial de ${entry.artist}`
          : `Abrir ${entry.artist}`
      }
    >
      {/* Box wrapper relativo para anclar los badges FUERA de .coverWrap.
          .coverWrap necesita overflow:hidden para clipear la imagen al
          circulo; si pusieramos los badges dentro, se cortarian en el
          borde del circulo. Ver bug visual reportado 2026-05-26. */}
      <div className={styles.avatarBox}>
        <div className={styles.coverWrap}>
          {entry.coverUrl
            ? <img className={styles.cover} src={entry.coverUrl} alt="" loading="lazy" />
            : <div className={styles.fallback}><Icon name="User" size={32} /></div>}
          <span className={styles.playBtn} aria-hidden="true">
            <Icon name="Play" size={16} filled />
          </span>
        </div>
        {entry.verified && (
          <span
            className={styles.verifiedBadge}
            title="Canal oficial verificado por YouTube"
            aria-label="Canal oficial"
          >
            <Icon name="BadgeCheck" size={14} filled />
          </span>
        )}
        {!entry.verified && entry.isTopic && (
          <span
            className={styles.topicBadge}
            title="Canal auto-generado por YouTube Music con el catálogo del sello"
            aria-label="YouTube Music"
          >
            <Icon name="Music" size={11} />
          </span>
        )}
      </div>
      <div className={styles.meta}>
        <span className={styles.title}>{entry.artist}</span>
        <span className={styles.sub}>{subtitleFor(entry)}</span>
      </div>
    </button>
  );
}
