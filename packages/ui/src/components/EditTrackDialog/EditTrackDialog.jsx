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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const titleRef = useRef(null);

  // Auto-focus en el titulo al abrir (despues del render del Modal).
  useEffect(() => {
    const t = setTimeout(() => titleRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const titleClean = title.trim();
  const artistClean = artist.trim();
  const pristine =
    titleClean === (track?.title ?? '').trim() &&
    artistClean === (track?.artist ?? '').trim();
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
      });
      onSaved?.(next);
      onClose();
    } catch (err) {
      setError(String(err?.message ?? err));
      setSaving(false);
    }
  };

  // Detectar Enter en inputs para confirmar (solo si valido).
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && canSave) {
      e.preventDefault();
      handleSave();
    }
  };

  if (!track) return null;

  return (
    <Modal onClose={onClose} title="Editar canción" size="sm">
      <form className={styles.form} onSubmit={handleSave}>
        {/* Preview del cover + ytId — recordatorio visual de que cancion editamos */}
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

        <label className={styles.field}>
          <span className={styles.label}>Título *</span>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={500}
            placeholder="Título de la canción"
            className={styles.input}
            data-error={titleInvalid || undefined}
          />
          {titleInvalid && (
            <span className={styles.helperErr}>El título no puede estar vacío.</span>
          )}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Artista</span>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={500}
            placeholder="Nombre del artista"
            className={styles.input}
          />
        </label>

        <p className={styles.hint}>
          <Icon name="Info" size={12} />
          Los cambios solo afectan a tu biblioteca personal y a tus otros
          dispositivos. Si eres el primero en limpiar este título en la
          red Ritmiq, futuros usuarios lo verán así también.
        </p>

        {error && (
          <div className={styles.error} role="alert">
            <Icon name="AlertTriangle" size={14} />
            <span>{error}</span>
          </div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={!canSave}
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
