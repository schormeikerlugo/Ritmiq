/**
 * Landing publica de un track compartido — accesible sin login.
 *
 * Se monta cuando `?share=track:<ytId>:<payload>` aparece en la URL.
 * Muestra el cover/title/artist + dos CTAs:
 *   - "Reproducir en Ritmiq" — abre el track en la app (requiere login).
 *   - "Ver en YouTube"       — fallback universal.
 *
 * NO contiene logica de player ni stores — es una vista standalone para
 * usuarios sin sesion. La intencion es funcionar como "tarjeta de presentacion"
 * del track con preview, no un mini reproductor.
 *
 * @module @ritmiq/ui/components/SharedView
 */
import logotipoUrl from '../../assets/logotipo.png';
import { Icon } from '../Icon/Icon.jsx';
import styles from './SharedView.module.css';

/**
 * @param {{
 *   share: { type:'track', ytId:string, title:string|null, artist:string|null, coverUrl:string|null },
 *   onOpenInApp: () => void,
 *   isAuthed: boolean,
 * }} props
 */
export function SharedView({ share, onOpenInApp, isAuthed }) {
  const { ytId, title, artist, coverUrl } = share;
  const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(ytId)}`;

  return (
    <div className={styles.wrap}>
      <header className={styles.brand}>
        <img src={logotipoUrl} alt="Ritmiq" className={styles.brandLogo} />
        <span className={styles.brandName}>Ritmiq</span>
      </header>

      <main className={styles.card}>
        <div className={styles.coverWrap}>
          {coverUrl ? (
            <img src={coverUrl} alt="" className={styles.cover} />
          ) : (
            <div className={styles.coverFallback}>
              <Icon name="Music" size={64} />
            </div>
          )}
        </div>

        <div className={styles.info}>
          <span className={styles.eyebrow}>Te compartieron este track</span>
          <h1 className={styles.title} data-selectable="true">
            {title || 'Track sin titulo'}
          </h1>
          {artist && (
            <p className={styles.artist} data-selectable="true">{artist}</p>
          )}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={onOpenInApp}
          >
            <Icon name="Play" size={18} filled />
            <span>{isAuthed ? 'Reproducir en Ritmiq' : 'Abrir Ritmiq'}</span>
          </button>
          <a
            className={styles.secondary}
            href={ytUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="Share2" size={16} />
            <span>Ver en YouTube</span>
          </a>
        </div>
      </main>

      <footer className={styles.foot}>
        <span>Reproducido por Ritmiq</span>
      </footer>
    </div>
  );
}
