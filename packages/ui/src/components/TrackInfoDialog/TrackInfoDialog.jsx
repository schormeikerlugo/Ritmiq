import { useEffect, useState } from 'react';
import { api, isDesktop } from '../../lib/api.js';
import { Modal } from '../Modal/Modal.jsx';
import { Icon } from '../Icon/Icon.jsx';
import styles from './TrackInfoDialog.module.css';

function fmtBytes(n) {
  if (!n) return '\u2014';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : 0)} ${u[i]}`;
}

function fmtDate(iso) {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleString();
  } catch { return iso; }
}

function fmtDur(s) {
  if (!Number.isFinite(s)) return '\u2014';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/**
 * @param {Object} props
 * @param {import('@ritmiq/core/types').Track} props.track
 * @param {() => void} props.onClose
 * @param {() => void} [props.onEdit]  Si se pasa, muestra boton "Editar"
 *   que cierra este modal y abre EditTrackDialog (controlado por el parent).
 */
export function TrackInfoDialog({ track, onClose, onEdit }) {
  const [size, setSize] = useState(null);

  useEffect(() => {
    if (!isDesktop || !track.isDownloaded) return;
    api.libraryFileSize(track.id).then(setSize).catch(() => setSize(null));
  }, [track.id, track.isDownloaded]);

  // Sanity check \u2014 si no llega track no renderizamos. Antes el dialog
  // renderizaba un contenedor vacio cuando la propia llamada pasaba un
  // track sin campos (bug reportado: 'se ve el contenedor pero no el
  // contenido').
  if (!track) return null;

  return (
    <Modal onClose={onClose} title="Detalles de la cancion" size="md">
      <div className={styles.body}>
        <div className={styles.cover}>
          {track.coverUrl
            ? <img src={track.coverUrl} alt="" loading="lazy" />
            : <Icon name="Music" size={32} />}
        </div>

        <div className={styles.song}>
          <div className={styles.songTitle}>{track.title ?? 'Sin titulo'}</div>
          <div className={styles.songArtist}>{track.artist ?? '\u2014'}</div>
          {onEdit && (
            <button
              type="button"
              className={styles.editBtn}
              onClick={onEdit}
              title="Editar título y artista"
            >
              <Icon name="Pencil" size={14} />
              <span>Editar</span>
            </button>
          )}
        </div>

        <dl className={styles.list}>
          <Row label="Album" value={track.album ?? '\u2014'} />
          <Row label="Duracion" value={fmtDur(track.durationSeconds)} />
          <Row label="Fuente" value={track.source === 'youtube' ? 'YouTube' : 'Local'} />
          {track.ytId && (
            <Row label="ID YouTube" value={<code className={styles.code}>{track.ytId}</code>} />
          )}
          <Row label="ID interno" value={<code className={styles.code}>{track.id}</code>} />
          <Row label="Anadida" value={fmtDate(track.createdAt)} />
          <Row
            label="Estado"
            value={
              track.isDownloaded
                ? <span className={styles.dlBadge}>Descargada \u00b7 {fmtBytes(size)}</span>
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
          >Abrir en YouTube \u2197</a>
        )}
      </div>
    </Modal>
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
