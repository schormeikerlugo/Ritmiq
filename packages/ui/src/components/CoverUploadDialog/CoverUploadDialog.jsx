import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/auth.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { resizeImage, uploadPlaylistCover } from '../../lib/storage.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './CoverUploadDialog.module.css';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPT = 'image/png, image/jpeg, image/webp, image/gif';

/**
 * @param {Object} props
 * @param {import('@ritmiq/core/types').Playlist} props.playlist
 * @param {() => void} props.onClose
 */
export function CoverUploadDialog({ playlist, onClose }) {
  const user = useAuthStore((s) => s.user);
  const setCover = usePlaylistsStore((s) => s.setCover);
  const fileInputRef = useRef(null);

  const [pending, setPending] = useState(/** @type {{ blob: Blob, mime: string, preview: string } | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('La imagen es demasiado grande (máx 5 MB).');
      return;
    }
    try {
      const { blob, mime, dataUrl } = await resizeImage(file, 800);
      setPending({ blob, mime, preview: dataUrl });
    } catch (err) {
      setError(String(err?.message ?? err));
    }
  };

  const onSave = async () => {
    if (!pending || !user) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadPlaylistCover({
        userId: user.id,
        playlistId: playlist.id,
        blob: pending.blob,
        mime: pending.mime,
      });
      await setCover(playlist.id, url);
      onClose();
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await setCover(playlist.id, null);
      onClose();
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>Cambiar portada</h2>
          <button
            className={styles.close}
            onClick={onClose}
            aria-label="Cerrar"
          ><Icon name="X" size={18} /></button>
        </header>

        <div
          className={styles.dropzone}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
        >
          {pending ? (
            <img src={pending.preview} alt="" className={styles.preview} />
          ) : playlist.coverUrl ? (
            <img src={playlist.coverUrl} alt="" className={styles.preview} />
          ) : (
            <div className={styles.placeholder}>
              <div className={styles.placeholderIcon}><Icon name="Upload" size={32} /></div>
              <p>Click para seleccionar imagen</p>
              <p className={styles.hint}>PNG, JPG, WebP — máx 5 MB</p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            onChange={onPick}
            className={styles.fileInput}
            disabled={busy}
          />
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          {playlist.coverUrl && !pending && (
            <button
              type="button"
              className={styles.btnDanger}
              onClick={onRemove}
              disabled={busy}
            >Quitar portada</button>
          )}
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={onClose}
            disabled={busy}
          >Cancelar</button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={onSave}
            disabled={busy || !pending}
          >{busy ? 'Subiendo…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}
