import { useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from '../../stores/library.js';
import { usePlayerStore } from '../../stores/player.js';
import { storageEstimate, clearAllLocal } from '../../lib/local-downloads.js';
import { useDownloadsStats } from '../../lib/use-downloads-stats.js';
import { isDesktop } from '../../lib/api.js';
import { Icon } from '../Icon/Icon.jsx';
import { ConfirmDialog, EmptyState } from '../primitives/index.js';
import { TrackRowSkeleton } from '../Skeleton/index.js';
import { usePullToRefresh } from '../../lib/use-pull-to-refresh.js';
import { PullIndicator } from '../PullToRefresh/PullToRefresh.jsx';
import { DownloadsSummary, fmtBytes } from './DownloadsSummary.jsx';
import styles from './Downloads.module.css';

function fmtDur(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

export function Downloads() {
  const tracks = useLibraryStore((s) => s.tracks);
  const libLoading = useLibraryStore((s) => s.loading);
  const undownload = useLibraryStore((s) => s.undownload);
  const playNow = usePlayerStore((s) => s.playNow);
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  const [estimate, setEstimate] = useState({ usage: 0, quota: 0 });
  const [confirmClear, setConfirmClear] = useState(false);

  // Estadísticas compartidas (count + totalSize + sizeByTrack), válidas en
  // desktop y PWA. El mismo hook alimenta el filtro "Descargados" de la
  // Biblioteca, evitando lógica duplicada.
  const { count, totalSize, sizeByTrack, refresh: refreshStats } = useDownloadsStats();

  const refresh = async () => {
    await refreshStats();
    if (!isDesktop) setEstimate(await storageEstimate());
  };

  useEffect(() => { if (!isDesktop) storageEstimate().then(setEstimate); }, [tracks]);

  // Pull-to-refresh — recarga estadísticas + estimate.
  const { bind: ptrBind, pullDistance, refreshing } = usePullToRefresh({
    onRefresh: refresh,
  });

  const downloadedTracks = useMemo(
    () => tracks
      .filter((t) => (isDesktop ? t.isDownloaded : sizeByTrack[t.id] != null))
      .map((t) => ({ ...t, _localSize: sizeByTrack[t.id] ?? 0 })),
    [tracks, sizeByTrack],
  );

  const usedPct = estimate.quota > 0 ? (estimate.usage / estimate.quota) * 100 : 0;

  const performClearAll = async () => {
    if (isDesktop) {
      for (const t of downloadedTracks) {
        try { await undownload(t.id); } catch {}
      }
    } else {
      await clearAllLocal();
      await useLibraryStore.getState().load();
    }
    refresh();
  };

  const onClearAll = () => setConfirmClear(true);

  return (
    <section className={styles.wrap} {...ptrBind}>
      <PullIndicator pullDistance={pullDistance} refreshing={refreshing} />
      <header className={styles.header}>
        <h1 className={styles.title}>Descargas</h1>
        <p className={styles.subtitle}>
          Música guardada en este dispositivo para escuchar sin internet.
        </p>
      </header>

      <DownloadsSummary count={count} totalSize={totalSize} />

      {!isDesktop && estimate.quota > 0 && (
        <div className={styles.storage}>
          <div className={styles.storageLabel}>
            <span>Almacenamiento del navegador</span>
            <span>{fmtBytes(estimate.usage)} / {fmtBytes(estimate.quota)}</span>
          </div>
          <div className={styles.storageBar}>
            <div className={styles.storageFill} style={{ width: `${Math.min(100, usedPct)}%` }} />
          </div>
        </div>
      )}

      {downloadedTracks.length > 0 && (
        <div className={styles.actions}>
          <button className={styles.danger} onClick={onClearAll}>
            Borrar todas las descargas
          </button>
        </div>
      )}

      {libLoading && downloadedTracks.length === 0 ? (
        <TrackRowSkeleton count={6} />
      ) : downloadedTracks.length === 0 ? (
        <EmptyState
          icon="ArrowDownToLine"
          title="No tienes música descargada en este dispositivo"
          subtitle="Desde una playlist o canción, usa ↓ Descargar para guardarla aquí y escucharla sin internet."
          size="md"
        />
      ) : (
        <ul className={styles.list}>
          {downloadedTracks.map((t, i) => {
            const playing = currentTrack?.id === t.id;
            return (
              <li key={t.id} className={styles.row} data-playing={playing}>
                <button
                  className={styles.cell}
                  onClick={() => playNow(downloadedTracks, i)}
                  aria-label={`Reproducir ${t.title}`}
                >
                  <div className={styles.thumb}>
                    {t.coverUrl
                      ? <img src={t.coverUrl} alt="" loading="lazy" />
                      : <Icon name="Music" size={18} />}
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.rowTitle}>{t.title}</span>
                    <span className={styles.rowArtist}>
                      {t.artist ?? '—'}
                      {t._localSize > 0 && ` · ${fmtBytes(t._localSize)}`}
                    </span>
                  </div>
                </button>
                <span className={styles.dur}>{fmtDur(t.durationSeconds)}</span>
                <button
                  className={styles.removeBtn}
                  onClick={() => undownload(t.id)}
                  aria-label="Quitar descarga"
                  title="Quitar descarga"
                ><Icon name="X" size={16} /></button>
              </li>
            );
          })}
        </ul>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Borrar todas las descargas"
          body={`Se eliminarán las ${downloadedTracks.length} canciones descargadas localmente. Las podrás volver a descargar cuando quieras.`}
          confirmLabel="Borrar todo"
          variant="danger"
          icon="Trash2"
          onConfirm={performClearAll}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </section>
  );
}
