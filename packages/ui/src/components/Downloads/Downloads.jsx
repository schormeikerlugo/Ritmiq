import { useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from '../../stores/library.js';
import { usePlayerStore } from '../../stores/player.js';
import { useAuthStore } from '../../stores/auth.js';
import { listLocalDownloads, storageEstimate, clearAllLocal } from '../../lib/local-downloads.js';
import { isDesktop, api } from '../../lib/api.js';
import { Icon } from '../Icon/Icon.jsx';
import { ConfirmDialog, EmptyState } from '../primitives/index.js';
import { TrackRowSkeleton } from '../Skeleton/index.js';
import { usePullToRefresh } from '../../lib/use-pull-to-refresh.js';
import { PullIndicator } from '../PullToRefresh/PullToRefresh.jsx';
import styles from './Downloads.module.css';

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : 0)} ${u[i]}`;
}

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
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const [localItems, setLocalItems] = useState([]);
  const [estimate, setEstimate] = useState({ usage: 0, quota: 0 });
  // Desktop: tamaño en disco por trackId (del IPC library:downloadsStats).
  const [desktopSizes, setDesktopSizes] = useState({ totalSize: 0, sizeByTrack: {} });
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = async () => {
    if (isDesktop) {
      // En desktop el estado isDownloaded ya viene en `tracks`. El peso en
      // disco lo trae el IPC downloadsStats (suma de statSync de los .opus).
      setLocalItems([]);
      try {
        const stats = await api.libraryDownloadsStats?.(userId);
        if (stats && typeof stats === 'object') {
          setDesktopSizes({
            totalSize: stats.totalSize ?? 0,
            sizeByTrack: stats.sizeByTrack ?? {},
          });
        }
      } catch {
        // Preload viejo sin el método: el conteo sigue funcionando, sin peso.
      }
      return;
    }
    const items = await listLocalDownloads();
    setLocalItems(items);
    setEstimate(await storageEstimate());
  };

  useEffect(() => { refresh(); }, [tracks]);

  // Pull-to-refresh — recarga el listado local desde IndexedDB + estimate.
  const { bind: ptrBind, pullDistance, refreshing } = usePullToRefresh({
    onRefresh: refresh,
  });

  const downloadedTracks = useMemo(() => {
    if (isDesktop) {
      return tracks
        .filter((t) => t.isDownloaded)
        .map((t) => ({ ...t, _localSize: desktopSizes.sizeByTrack[t.id] ?? 0 }));
    }
    const sizeMap = new Map(localItems.map((i) => [i.trackId, i.size]));
    return tracks
      .filter((t) => sizeMap.has(t.id))
      .map((t) => ({ ...t, _localSize: sizeMap.get(t.id) ?? 0 }));
  }, [tracks, localItems, desktopSizes]);

  // Peso total: en desktop viene del IPC (suma real en disco); en PWA se
  // suma del tamaño de cada blob de IndexedDB.
  const totalSize = isDesktop
    ? desktopSizes.totalSize
    : downloadedTracks.reduce((acc, t) => acc + (t._localSize ?? 0), 0);
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

      {downloadedTracks.length > 0 && (
        <div className={styles.summary}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryIcon} aria-hidden="true">
              <Icon name="ArrowDownToLine" size={18} />
            </span>
            <div className={styles.summaryText}>
              <span className={styles.summaryValue}>{downloadedTracks.length}</span>
              <span className={styles.summaryLabel}>
                {downloadedTracks.length === 1 ? 'canción descargada' : 'canciones descargadas'}
              </span>
            </div>
          </div>
          <div className={styles.summaryDivider} aria-hidden="true" />
          <div className={styles.summaryItem}>
            <span className={styles.summaryIcon} aria-hidden="true">
              <Icon name="Disc3" size={18} />
            </span>
            <div className={styles.summaryText}>
              <span className={styles.summaryValue}>
                {totalSize > 0 ? fmtBytes(totalSize) : '—'}
              </span>
              <span className={styles.summaryLabel}>ocupados en disco</span>
            </div>
          </div>
        </div>
      )}

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
