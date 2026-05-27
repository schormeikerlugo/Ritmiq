import { useEffect, useRef, useState } from 'react';
import { useLibraryStore } from '../../stores/library.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { isEphemeralTrack } from '../../lib/track-helpers.js';
import { useMobileViewport } from '../../lib/use-mobile-viewport.js';
import { isDesktop } from '../../lib/api.js';
import { Icon } from '../Icon/Icon.jsx';
import { Modal } from '../Modal/Modal.jsx';
import { Button, TextField } from '../primitives/index.js';
import { useBottomSheet } from '../../stores/bottom-sheet.js';
import styles from './SaveDialog.module.css';

/**
 * Cuerpo del dialog — extraido como componente propio para que tenga su
 * propio state local (creating, newName) y pueda re-renderizarse
 * aisladamente sin forzar al BottomSheet a recrearse en cada teclazo.
 *
 * @param {Object} props
 * @param {import('@ritmiq/core/types').Track} props.track
 * @param {() => void} props.onClose
 */
function SaveBody({ track, onClose }) {
  const persistEphemeral = useLibraryStore((s) => s.persistEphemeral);
  const tracks = useLibraryStore((s) => s.tracks);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const contents = usePlaylistsStore((s) => s.contents);
  const create = usePlaylistsStore((s) => s.create);
  const addTrack = usePlaylistsStore((s) => s.addTrack);
  const removeTrack = usePlaylistsStore((s) => s.removeTrack);

  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const newNameRef = useRef(null);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  const isInLibrary = !isEphemeralTrack(track) && tracks.some((t) => t.id === track.id);

  /** Asegura que el track existe en la biblioteca (persiste si era efímero). */
  const ensurePersisted = async () => {
    if (isEphemeralTrack(track)) {
      const p = await persistEphemeral(track);
      return p.id;
    }
    if (!isInLibrary) {
      const p = await persistEphemeral(track);
      return p.id;
    }
    return track.id;
  };

  const onSaveLibrary = async () => {
    setBusy(true);
    try {
      await ensurePersisted();
      onClose();
    } finally { setBusy(false); }
  };

  const onTogglePlaylist = async (pl) => {
    setBusy(true);
    try {
      const id = await ensurePersisted();
      const present = (contents[pl.id] ?? []).includes(id);
      if (present) await removeTrack(pl.id, id);
      else await addTrack(pl.id, id);
    } finally { setBusy(false); }
  };

  const onCreate = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const id = await ensurePersisted();
      const pl = await create(name);
      await addTrack(pl.id, id);
      setCreating(false);
      setNewName('');
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <>
      <p className={styles.song}>
        <strong>{track.title}</strong>
        {track.artist ? ` · ${track.artist}` : ''}
      </p>

      <div className={styles.section}>
        <button
          className={styles.action}
          onClick={onSaveLibrary}
          disabled={busy || isInLibrary}
        >
          <span className={styles.actionIcon}><Icon name="Library" size={16} /></span>
          <span className={styles.actionLabel}>
            {isInLibrary ? 'Ya está en tu biblioteca' : 'Solo añadir a biblioteca'}
          </span>
        </button>
      </div>

      <div className={styles.sectionTitle}>Playlists</div>
      <ul className={styles.list}>
        {playlists.map((pl) => {
          const checked = isInLibrary &&
            (contents[pl.id] ?? []).includes(track.id);
          return (
            <li key={pl.id}>
              <button
                className={styles.row}
                onClick={() => onTogglePlaylist(pl)}
                disabled={busy}
              >
                <span
                  className={styles.checkbox}
                  data-checked={checked}
                  aria-hidden="true"
                >{checked && <Icon name="Check" size={14} />}</span>
                <span className={styles.rowName}>{pl.name}</span>
              </button>
            </li>
          );
        })}
        {playlists.length === 0 && (
          <li className={styles.empty}>Aún no tienes playlists.</li>
        )}
      </ul>

      {creating ? (
        <form className={styles.createForm} onSubmit={onCreate}>
          <TextField
            ref={newNameRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre de la playlist"
            disabled={busy}
            maxLength={80}
          />
          <div className={styles.createActions}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setCreating(false); setNewName(''); }}
              disabled={busy}
            >Cancelar</Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={busy}
              loadingText="Creando..."
              disabled={!newName.trim()}
            >Crear y añadir</Button>
          </div>
        </form>
      ) : (
        <button
          className={styles.createBtn}
          onClick={() => setCreating(true)}
          disabled={busy}
        ><Icon name="Plus" size={16} /> Nueva playlist</button>
      )}
    </>
  );
}

/**
 * Wrapper que decide entre BottomSheet (mobile) o Modal centrado (desktop)
 * y delega el contenido a <SaveBody>. SaveBody tiene state propio, asi el
 * sheet no se recrea en cada teclazo.
 *
 * @param {Object} props
 * @param {import('@ritmiq/core/types').Track} props.track
 * @param {() => void} props.onClose
 */
export function SaveDialog({ track, onClose }) {
  const isMobile = useMobileViewport();
  const useSheet = isMobile && !isDesktop;

  /* PWA mobile: empuja el SaveBody al store global; el render lo hace
     BottomSheetHost. */
  const openSheet = useBottomSheet((s) => s.open);
  const closeSheetById = useBottomSheet((s) => s.closeById);
  const sheetIdRef = useRef(null);

  useEffect(() => {
    if (!useSheet) return;
    const id = openSheet({
      title: 'Guardar canción',
      content: <div className={styles.sheetBody}><SaveBody track={track} onClose={onClose} /></div>,
      onClose,
    });
    sheetIdRef.current = id;
    return () => {
      if (sheetIdRef.current != null) {
        closeSheetById(sheetIdRef.current);
        sheetIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSheet]);

  if (useSheet) return null;

  /* Desktop: Modal primitive (anim consistente + lock body + esc) */
  return (
    <Modal onClose={onClose} title="Guardar canción" size="sm">
      <SaveBody track={track} onClose={onClose} />
    </Modal>
  );
}
