import { useEffect, useState } from 'react';
import { useDownloadsStore } from '../../stores/downloads.js';
import styles from './DownloadProgress.module.css';

export function DownloadProgress() {
  const { entries, visible, hide, clearFinished } = useDownloadsStore();
  const [collapsed, setCollapsed] = useState(false);

  // Auto-ocultar 3s después de que termine todo
  useEffect(() => {
    if (!visible) return;
    const allDone = entries.length > 0 &&
      entries.every((e) => e.status === 'done' || e.status === 'error');
    if (!allDone) return;
    const t = setTimeout(() => {
      clearFinished();
      hide();
    }, 3000);
    return () => clearTimeout(t);
  }, [visible, entries, clearFinished, hide]);

  if (!visible || entries.length === 0) return null;

  const total = entries.length;
  const done = entries.filter((e) => e.status === 'done').length;
  const errors = entries.filter((e) => e.status === 'error').length;
  const running = entries.filter((e) => e.status === 'running');
  const overall = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = done + errors === total;

  return (
    <div className={styles.wrap} data-collapsed={collapsed}>
      <header className={styles.header}>
        <div className={styles.title}>
          {allDone
            ? `Descarga completa · ${done}/${total}`
            : `Descargando · ${done}/${total}`}
        </div>
        <div className={styles.controls}>
          <button
            className={styles.iconBtn}
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expandir' : 'Contraer'}
          >{collapsed ? '▴' : '▾'}</button>
          <button
            className={styles.iconBtn}
            onClick={() => { clearFinished(); hide(); }}
            aria-label="Cerrar"
          >×</button>
        </div>
      </header>

      {!collapsed && (
        <>
          <div className={styles.overall}>
            <div className={styles.overallBar}>
              <div className={styles.overallFill} style={{ width: `${overall}%` }} />
            </div>
            <span className={styles.overallText}>{overall}%</span>
          </div>

          <ul className={styles.list}>
            {running.map((e) => (
              <li key={e.trackId} className={styles.item}>
                <span className={styles.itemTitle}>{e.title}</span>
                <div className={styles.itemBar}>
                  <div
                    className={styles.itemFill}
                    style={{ width: `${e.progress}%` }}
                  />
                </div>
                <span className={styles.itemPct}>{Math.round(e.progress)}%</span>
              </li>
            ))}
            {errors > 0 && (
              <li className={styles.errorRow}>
                {errors} {errors === 1 ? 'error' : 'errores'} durante la descarga
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
