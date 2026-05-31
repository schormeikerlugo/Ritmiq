/**
 * DownloadsSummary — tarjeta de resumen de descargas: nº de canciones +
 * peso ocupado en disco. Reutilizable en la vista Downloads (desktop) y en
 * el filtro "Descargados" de la Biblioteca (PWA móvil).
 *
 * @module @ritmiq/ui/components/Downloads/DownloadsSummary
 */
import { Icon } from '../Icon/Icon.jsx';
import styles from './Downloads.module.css';

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : 0)} ${u[i]}`;
}

/**
 * @param {{ count: number, totalSize: number, compact?: boolean }} props
 *   compact: variante más baja para incrustar dentro de la Biblioteca.
 */
export function DownloadsSummary({ count, totalSize, compact = false }) {
  if (!count) return null;
  return (
    <div className={styles.summary} data-compact={compact || undefined}>
      <div className={styles.summaryItem}>
        <span className={styles.summaryIcon} aria-hidden="true">
          <Icon name="ArrowDownToLine" size={compact ? 16 : 18} />
        </span>
        <div className={styles.summaryText}>
          <span className={styles.summaryValue}>{count}</span>
          <span className={styles.summaryLabel}>
            {count === 1 ? 'canción descargada' : 'canciones descargadas'}
          </span>
        </div>
      </div>
      <div className={styles.summaryDivider} aria-hidden="true" />
      <div className={styles.summaryItem}>
        <span className={styles.summaryIcon} aria-hidden="true">
          <Icon name="Disc3" size={compact ? 16 : 18} />
        </span>
        <div className={styles.summaryText}>
          <span className={styles.summaryValue}>
            {totalSize > 0 ? fmtBytes(totalSize) : '—'}
          </span>
          <span className={styles.summaryLabel}>ocupados en disco</span>
        </div>
      </div>
    </div>
  );
}
