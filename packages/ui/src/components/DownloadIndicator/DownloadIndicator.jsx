/**
 * Indicador visual del estado de descarga de una canción.
 *  - idle    → no muestra nada
 *  - queued  → punto pulsante atenuado ("⋯")
 *  - running → spinner con porcentaje
 *  - done    → punto verde sólido (●) — equivalente al de desktop
 *  - error   → triángulo rojo
 *
 * Pensado para integrarse en la columna de la fila de track tanto en
 * Library como en PlaylistView; tiene tamaño fijo para no causar layout shift.
 */
import { useDownloadStatus, useDownloadProgress } from '../../lib/use-download-status.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './DownloadIndicator.module.css';

/**
 * @param {{trackId:string, isDownloaded:boolean, className?:string}} props
 */
export function DownloadIndicator({ trackId, isDownloaded, className }) {
  const status = useDownloadStatus(trackId, isDownloaded);
  const progress = useDownloadProgress(trackId);

  const wrap = [styles.wrap, className].filter(Boolean).join(' ');

  if (status === 'idle') {
    return <span className={wrap} aria-hidden="true" />;
  }

  if (status === 'done') {
    return (
      <span className={wrap} title="Descargada y disponible offline">
        <span className={styles.ok}><Icon name="CheckCircle2" size={14} filled /></span>
      </span>
    );
  }

  if (status === 'queued') {
    return (
      <span className={wrap} title="En cola para descargar">
        <span className={styles.queued}><Icon name="MoreHorizontal" size={14} /></span>
      </span>
    );
  }

  if (status === 'running') {
    return (
      <span className={wrap} title={`Descargando ${Math.round(progress)}%`}>
        <svg className={styles.spinner} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" className={styles.track} />
          <circle
            cx="12"
            cy="12"
            r="9"
            className={styles.fill}
            style={{
              strokeDasharray: 2 * Math.PI * 9,
              strokeDashoffset: 2 * Math.PI * 9 * (1 - Math.max(0, Math.min(1, progress / 100))),
            }}
          />
        </svg>
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span className={wrap} title="Error al descargar">
        <span className={styles.error}>!</span>
      </span>
    );
  }
  return null;
}
