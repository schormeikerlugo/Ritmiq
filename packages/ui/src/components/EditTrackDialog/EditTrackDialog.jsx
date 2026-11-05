/**
 * EditTrackDialog — modal para que el usuario corrija el title/artist
 * de un track ya guardado en su biblioteca.
 *
 * Casos de uso:
 *   - YouTube le entrega "Waiting For The End (Official Music Video)
 *     [4K Upgrade]" y el user quiere dejar "Waiting For The End".
 *   - El artista quedó como "LinkinParkVEVO" y prefiere "Linkin Park".
 *   - "Buscar portada": elegir la portada oficial entre los candidatos del
 *     servidor (iTunes/Deezer, /art/candidates). Queda como portada manual
 *     y gana a la automática; "Usar la automática" la devuelve.
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
import { TrackImg } from '../primitives/TrackImg.jsx';
import { artCandidates } from '../../lib/lan-client.js';
import { isYouTubeThumb } from '../../lib/track-art.js';

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
  // Portada: undefined = sin cambios; string = nueva URL elegida.
  const [cover, setCover] = useState(undefined);
  const [cands, setCands] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
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
    albumClean === (track?.album ?? '').trim() &&
    cover === undefined;
  const hasManualCover = !!track?.coverUrl && !isYouTubeThumb(track.coverUrl);

  const searchCovers = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const { candidates } = await artCandidates({
        title: titleClean, artist: artistClean, durationSeconds: track?.durationSeconds ?? null,
      });
      setCands(candidates ?? []);
    } catch (e) {
      setSearchError('No se pudo buscar ahora. Inténtalo más tarde.');
    } finally {
      setSearching(false);
    }
  };
  // Volver a la automática: la miniatura de YouTube (la portada oficial
  // identificada por el servidor se aplica sola encima).
  const useAutomatic = () => setCover(track?.ytId ? `https://i.ytimg.com/vi/${track.ytId}/hqdefault.jpg` : '');
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
        ...(cover !== undefined && { coverUrl: cover }),
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
            {cover !== undefined
              ? (cover ? <TrackImg track={{ ...track, coverUrl: cover }} /> : <Icon name="Music" size={20} />)
              : track.coverUrl
                ? <TrackImg track={track} loading="lazy" />
                : <Icon name="Music" size={20} />}
          </div>
          <div className={styles.previewMeta}>
            <div className={styles.previewTitle}>{titleClean || 'Sin título'}</div>
            <div className={styles.previewArtist}>{artistClean || 'Sin artista'}</div>
          </div>
        </div>

        <div className={styles.coverActions}>
          <Button type="button" variant="subtle" size="sm" iconLeft="Search" onClick={searchCovers} loading={searching} loadingText="Buscando…">
            Buscar portada
          </Button>
          {(hasManualCover || (cover !== undefined && !isYouTubeThumb(cover))) && (
            <Button type="button" variant="ghost" size="sm" onClick={useAutomatic}>
              Usar la automática
            </Button>
          )}
        </div>
        {searchError && <p className={styles.coverMsg}>{searchError}</p>}
        {cands && cands.length === 0 && (
          <p className={styles.coverMsg}>No encontramos portadas. Prueba a corregir el título o el artista y busca de nuevo.</p>
        )}
        {cands && cands.length > 0 && (
          <ul className={styles.candGrid} aria-label="Portadas encontradas">
            {cands.map((c) => (
              <li key={`${c.source}-${c.cover}`}>
                <button
                  type="button"
                  className={styles.cand}
                  data-selected={cover === c.cover || undefined}
                  onClick={() => setCover(c.cover)}
                  title={`${c.artist} – ${c.title}${c.album ? ` (${c.album})` : ''}`}
                >
                  <img
                    src={c.coverSmall ?? c.cover}
                    alt=""
                    loading="lazy"
                    // Algún CDN bloquea por región: fuera la opción entera.
                    onError={(e) => { const li = e.currentTarget.closest('li'); if (li) li.style.display = 'none'; }}
                  />
                  <span className={styles.candText}>
                    <span className={styles.candTitle}>{c.album || c.title}</span>
                    <span className={styles.candSub}>{c.artist}{c.year ? ` · ${c.year}` : ''}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

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
