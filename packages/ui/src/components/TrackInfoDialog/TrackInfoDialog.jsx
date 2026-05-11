import { useEffect, useState } from 'react';
import { api, isDesktop } from '../../lib/api.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './TrackInfoDialog.module.css';

function fmtBytes(n) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : 0)} ${u[i]}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch { return iso; }
}

function fmtDur(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/**
 * @param {Object} props
 * @param {import('@ritmiq/core/types').Track} props.track
 * @param {() => void} props.onClose
 */
export function TrackInfoDialog({ track, onClose }) {
  const [size, setSize] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!isDesktop || !track.isDownloaded) return;
    api.libraryFileSize(track.id).then(setSize).catch(() => setSize(null));
  }, [track.id, track.isDownloaded]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>Detalles de la canción</h2>
          <button
            className={styles.close}
            onClick={onClose}
            aria-label="Cerrar"
          ><Icon name="X" size={18} /></button>
        </header>

        <div className={styles.cover}>
          {track.coverUrl
            ? <img src={track.coverUrl} alt="" />
            : <Icon name="Music" size={32} />}
        </div>

        <div className={styles.song}>
          <div className={styles.songTitle}>{track.title}</div>
          <div className={styles.songArtist}>{track.artist ?? '—'}</div>
        </div>

        <dl className={styles.list}>
          <Row label="Álbum" value={track.album ?? '—'} />
          <Row label="Duración" value={fmtDur(track.durationSeconds)} />
          <Row label="Fuente" value={track.source === 'youtube' ? 'YouTube' : 'Local'} />
          {track.ytId && (
            <Row label="ID YouTube" value={<code className={styles.code}>{track.ytId}</code>} />
          )}
          <Row label="ID interno" value={<code className={styles.code}>{track.id}</code>} />
          <Row label="Añadida" value={fmtDate(track.createdAt)} />
          <Row
            label="Estado"
            value={
              track.isDownloaded
                ? <span className={styles.dlBadge}>Descargada · {fmtBytes(size)}</span>
                : <span className={styles.streamBadge}>Streaming</span>
            }
          />
          {track.filePath && (
            <Row label="Archivo local" value={<code className={styles.code}>{track.filePath}</code>} />
          )}
        </dl>

        {track.ytId && (
          <a
            className={styles.openLink}
            href={`https://www.youtube.com/watch?v=${track.ytId}`}
            target="_blank"
            rel="noopener noreferrer"
          >Abrir en YouTube ↗</a>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className={styles.row}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{value}</dd>
    </div>
  );
}
