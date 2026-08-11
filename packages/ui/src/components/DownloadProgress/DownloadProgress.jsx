import { useEffect, useState } from 'react';
import { useDownloadsStore } from '../../stores/downloads.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './DownloadProgress.module.css';

/**
 * Indicador GLOBAL de descargas — píldora compacta (no invasiva).
 *
 * Por defecto es una píldora pequeña de una línea abajo-derecha con un
 * anillo de progreso + "Descargando N/M". El detalle por-track (barras) ya
 * vive en el DownloadIndicator de cada fila; aquí solo damos el agregado
 * para saber cuántas faltan sin tapar contenido. Se puede tocar para
 * expandir la lista si el usuario quiere ver el detalle.
 */
export function DownloadProgress() {
  const { entries, visible, hide, clearFinished } = useDownloadsStore();
  const [expanded, setExpanded] = useState(false);

  // Auto-ocultar 2.5s después de que termine todo.
  useEffect(() => {
    if (!visible) return;
    const allDone = entries.length > 0 &&
      entries.every((e) => e.status === 'done' || e.status === 'error');
    if (!allDone) return;
    const t = setTimeout(() => {
      clearFinished();
      hide();
      setExpanded(false);
    }, 2500);
    return () => clearTimeout(t);
  }, [visible, entries, clearFinished, hide]);

  if (!visible || entries.length === 0) return null;

  const total = entries.length;
  const done = entries.filter((e) => e.status === 'done').length;
  const errored = entries.filter((e) => e.status === 'error');
  const errors = errored.length;
  const running = entries.filter((e) => e.status === 'running');
  const overall = total > 0 ? Math.round(((done + errors) / total) * 100) : 0;
  const allDone = done + errors === total;

  // Anillo de progreso (SVG) — mismo lenguaje visual que DownloadIndicator.
  const R = 9;
  const C = 2 * Math.PI * R;

  const label = allDone
    ? (errors > 0 ? `Listo · ${done}/${total}` : `Descargas listas`)
    : `Descargando ${done + running.length}/${total}`;

  return (
    <div className={styles.wrap} data-expanded={expanded || undefined}>
      {/* Píldora compacta (siempre visible) */}
      <button
        type="button"
        className={styles.pill}
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? 'Ocultar detalle de descargas' : 'Ver detalle de descargas'}
      >
        <span className={styles.ring} aria-hidden="true">
          {allDone ? (
            <Icon name={errors > 0 ? 'AlertCircle' : 'CheckCircle2'} size={16} filled />
          ) : (
            <svg viewBox="0 0 24 24" className={styles.ringSvg}>
              <circle cx="12" cy="12" r={R} className={styles.ringTrack} />
              <circle
                cx="12" cy="12" r={R}
                className={styles.ringFill}
                style={{ strokeDasharray: C, strokeDashoffset: C * (1 - overall / 100) }}
              />
            </svg>
          )}
        </span>
        <span className={styles.pillLabel}>{label}</span>
        {!allDone && <span className={styles.pillPct}>{overall}%</span>}
        <span
          className={styles.pillClose}
          role="button"
          tabIndex={0}
          aria-label="Cerrar"
          onClick={(e) => { e.stopPropagation(); clearFinished(); hide(); setExpanded(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); clearFinished(); hide(); setExpanded(false); } }}
        >
          <Icon name="X" size={14} />
        </span>
      </button>

      {/* Detalle expandible (opcional, oculto por defecto) */}
      {expanded && (running.length > 0 || errored.length > 0) && (
        <ul className={styles.list}>
          {running.map((e) => (
            <li key={e.trackId} className={styles.item}>
              <span className={styles.itemTitle}>{e.title}</span>
              <div className={styles.itemBar}>
                <div className={styles.itemFill} style={{ width: `${e.progress}%` }} />
              </div>
              <span className={styles.itemPct}>{Math.round(e.progress)}%</span>
            </li>
          ))}
          {errored.map((e) => (
            <li key={`err-${e.trackId}`} className={styles.errorRow} title={e.error}>
              <span className={styles.errorTitle}><Icon name="X" size={12} /> {e.title}</span>
              {e.error && <span className={styles.errorMsg}>{e.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
