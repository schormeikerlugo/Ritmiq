import { useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from '../../stores/library.js';
import { usePlayerStore } from '../../stores/player.js';
import { listLocalDownloads, storageEstimate, clearAllLocal } from '../../lib/local-downloads.js';
import { isDesktop } from '../../lib/api.js';
import { Icon } from '../Icon/Icon.jsx';
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

  const [localItems, setLocalItems] = useState([]);
  const [estimate, setEstimate] = useState({ usage: 0, quota: 0 });

  const refresh = async () => {
    if (isDesktop) {
      // En desktop el estado isDownloaded ya viene en `tracks`.
      setLocalItems([]);
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
    if (isDesktop) return tracks.filter((t) => t.isDownloaded);
    const sizeMap = new Map(localItems.map((i) => [i.trackId, i.size]));
    return tracks
      .filter((t) => sizeMap.has(t.id))
      .map((t) => ({ ...t, _localSize: sizeMap.get(t.id) ?? 0 }));
  }, [tracks, localItems]);

  const totalSize = downloadedTracks.reduce((acc, t) => acc + (t._localSize ?? 0), 0);
  const usedPct = estimate.quota > 0 ? (estimate.usage / estimate.quota) * 100 : 0;

  const onClearAll = async () => {
    if (!confirm(`¿Borrar las ${downloadedTracks.length} descargas locales?`)) return;
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

  return (
    <section className={styles.wrap} {...ptrBind}>
      <PullIndicator pullDistance={pullDistance} refreshing={refreshing} />
      <header className={styles.header}>
        <h1 className={styles.title}>Descargas</h1>
        <p className={styles.subtitle}>
          {downloadedTracks.length} {downloadedTracks.length === 1 ? 'canción' : 'canciones'}
          {!isDesktop && totalSize > 0 && ` · ${fmtBytes(totalSize)}`}
        </p>
      </header>

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
        <div className={styles.empty}>
          <p>No tienes música descargada en este dispositivo.</p>
          <p className={styles.hint}>
            Desde una playlist o canción, usa <strong>↓ Descargar</strong> para guardarla aquí
            y poder escucharla sin internet.
          </p>
        </div>
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
                      ? <img src={t.coverUrl} alt="" />
                      : <Icon name="Music" size={18} />}
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.rowTitle}>{t.title}</span>
                    <span className={styles.rowArtist}>
                      {t.artist ?? '—'}
                      {!isDesktop && t._localSize > 0 && ` · ${fmtBytes(t._localSize)}`}
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
    </section>
  );
}
