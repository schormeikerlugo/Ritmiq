/**
 * EditTrackDialog — modal para que el usuario corrija el title/artist
 * de un track ya guardado en su biblioteca.
 *
 * Casos de uso:
 *   - YouTube le entrega "Waiting For The End (Official Music Video)
 *     [4K Upgrade]" y el user quiere dejar "Waiting For The End".
 *   - El artista quedó como "LinkinParkVEVO" y prefiere "Linkin Park".
 *
 * EFECTOS DEL SAVE:
 *   1. Optimistic update inmediato en su biblioteca (Zustand).
 *   2. Persiste a Supabase tracks (RLS owner-only).
 *   3. En desktop, replica a SQLite local via IPC library:update.
 *   4. Si el track esta sonando, el Player + NowPlaying + MediaSession
 *      se actualizan automaticamente (side effect en library.updateMeta).
 *   5. Realtime propaga el UPDATE a otros devices del mismo user.
 *   6. Fire-and-forget: contribuye al diccionario global tracks_global.
 *      Si era el primer humano publicando ese ytId, su edicion se
 *      vuelve canonica para futuros usuarios.
 *
 * IMPORTANTE: la edicion solo afecta SU biblioteca personal. Otros users
 * con el mismo ytId no ven cambios. tracks_global respeta first-write-wins.
 *
 * @module @ritmiq/ui/components/EditTrackDialog
 */
import { useState, useEffect, useRef } from 'react';
import { Modal } from '../Modal/Modal.jsx';
import { Icon } from '../Icon/Icon.jsx';
import { Button, TextField, FormError } from '../primitives/index.js';
import { useLibraryStore } from '../../stores/library.js';
import styles from './EditTrackDialog.module.css';

/**
 * @param {Object} props
 * @param {import('@ritmiq/core').Track} props.track  Track con los valores actuales.
 * @param {() => void} props.onClose
 * @param {(updated: import('@ritmiq/core').Track) => void} [props.onSaved]  Callback opcional.
 */
export function EditTrackDialog({ track, onClose, onSaved }) {
  const updateMeta = useLibraryStore((s) => s.updateMeta);

  const [title, setTitle] = useState(track?.title ?? '');
  const [artist, setArtist] = useState(track?.artist ?? '');
  const [album, setAlbum] = useState(track?.album ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const titleRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const titleClean = title.trim();
  const artistClean = artist.trim();
  const albumClean = album.trim();
  const pristine =
    titleClean === (track?.title ?? '').trim() &&
    artistClean === (track?.artist ?? '').trim() &&
    albumClean === (track?.album ?? '').trim();
  const titleInvalid = titleClean.length === 0;
  const canSave = !pristine && !titleInvalid && !saving;

  const handleSave = async (e) => {
    e?.preventDefault?.();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateMeta(track.id, {
        title: titleClean,
        artist: artistClean || null,
        album: albumClean || null,
      });
      onSaved?.(next);
      onClose();
    } catch (err) {
      setError(String(err?.message ?? err));
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && canSave) {
      e.preventDefault();
      handleSave();
    }
  };

  if (!track) return null;

  return (
    <Modal
      onClose={onClose}
      title="Editar canción"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="edit-track-form"
            variant="primary"
            loading={saving}
            loadingText="Guardando..."
            disabled={!canSave}
          >
            Guardar
          </Button>
        </>
      }
    >
      <form id="edit-track-form" className={styles.form} onSubmit={handleSave}>
        {/* Preview del cover + title/artist */}
        <div className={styles.preview}>
          <div className={styles.cover}>
            {track.coverUrl
              ? <img src={track.coverUrl} alt="" loading="lazy" />
              : <Icon name="Music" size={20} />}
          </div>
          <div className={styles.previewMeta}>
            <div className={styles.previewTitle}>{titleClean || 'Sin título'}</div>
            <div className={styles.previewArtist}>{artistClean || 'Sin artista'}</div>
          </div>
        </div>

        <TextField
          ref={titleRef}
          label="Título"
          required
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={500}
          placeholder="Título de la canción"
          error={titleInvalid ? 'El título no puede estar vacío.' : undefined}
        />

        <TextField
          label="Artista"
          type="text"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={500}
          placeholder="Nombre del artista"
        />

        <TextField
          label="Álbum"
          optional
          type="text"
          value={album}
          onChange={(e) => setAlbum(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={500}
          placeholder="Nombre del álbum"
        />

        <p className={styles.hint}>
          <Icon name="Info" size={12} />
          Los cambios solo afectan a tu biblioteca personal y a tus otros
          dispositivos. Si eres el primero en limpiar este título en la
          red Ritmiq, futuros usuarios lo verán así también.
        </p>

        <FormError onDismiss={() => setError(null)}>{error}</FormError>
      </form>
    </Modal>
  );
}
