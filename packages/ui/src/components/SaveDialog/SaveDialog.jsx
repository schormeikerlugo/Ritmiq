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
import { toast } from '../../stores/toast.js';
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
function SaveBody({ track, tracks: tracksProp, onClose }) {
  const persistEphemeral = useLibraryStore((s) => s.persistEphemeral);
  const libraryTracks = useLibraryStore((s) => s.tracks);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const contents = usePlaylistsStore((s) => s.contents);
  const create = usePlaylistsStore((s) => s.create);
  const addTrack = usePlaylistsStore((s) => s.addTrack);
  const removeTrack = usePlaylistsStore((s) => s.removeTrack);
  const addTracks = usePlaylistsStore((s) => s.addTracks);
  const removeTracks = usePlaylistsStore((s) => s.removeTracks);

  // Modo multi: si llega `tracks` (array) operamos sobre todos; si no,
  // back-compat con el `track` único.
  const multi = Array.isArray(tracksProp) && tracksProp.length > 0;
  const items = multi ? tracksProp : (track ? [track] : []);

  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const newNameRef = useRef(null);

  useEffect(() => {
    if (creating) newNameRef.current?.focus();
  }, [creating]);

  const inLibrary = (t) => !isEphemeralTrack(t) && libraryTracks.some((x) => x.id === t.id);
  const allInLibrary = items.every(inLibrary);

  /** Asegura que un track existe en la biblioteca (persiste si era efímero). */
  const ensurePersistedOne = async (t) => {
    if (isEphemeralTrack(t) || !inLibrary(t)) {
      const p = await persistEphemeral(t);
      return p.id;
    }
    return t.id;
  };

  /** Persiste todos los items y devuelve sus ids reales. */
  const ensurePersistedAll = async () => {
    const ids = [];
    for (const t of items) ids.push(await ensurePersistedOne(t));
    return ids;
  };

  const onSaveLibrary = async () => {
    setBusy(true);
    try {
      await ensurePersistedAll();
      toast.success(
        multi ? `${items.length} añadidas a tu biblioteca` : 'Añadida a tu biblioteca',
        { icon: 'Library' },
      );
      onClose();
    } finally { setBusy(false); }
  };

  // Estado del checkbox por playlist: 'all' | 'some' | 'none'.
  const playlistState = (pl) => {
    const ids = items.map((t) => t.id);
    const list = contents[pl.id] ?? [];
    const inPl = ids.filter((id) => list.includes(id));
    if (inPl.length === 0) return 'none';
    if (inPl.length === ids.length) return 'all';
    return 'some';
  };

  const onTogglePlaylist = async (pl) => {
    setBusy(true);
    try {
      const ids = await ensurePersistedAll();
      const list = usePlaylistsStore.getState().contents[pl.id] ?? [];
      const allPresent = ids.every((id) => list.includes(id));
      if (multi) {
        // Si están todos, quitar todos; si no, añadir los que falten.
        if (allPresent) await removeTracks(pl.id, ids);
        else await addTracks(pl.id, ids);
      } else {
        if (allPresent) await removeTrack(pl.id, ids[0]);
        else await addTrack(pl.id, ids[0]);
      }
    } finally { setBusy(false); }
  };

  const onCreate = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const ids = await ensurePersistedAll();
      const pl = await create(name);          // store emite toast 'Playlist X creada'
      if (multi) await addTracks(pl.id, ids);  // toast agregado
      else await addTrack(pl.id, ids[0]);      // toast 'Añadida a X'
      setCreating(false);
      setNewName('');
      onClose();
    } finally { setBusy(false); }
  };

  const headerLabel = multi
    ? `${items.length} canciones seleccionadas`
    : (items[0]?.title ?? '');

  return (
    <>
      <p className={styles.song}>
        {multi ? (
          <strong>{headerLabel}</strong>
        ) : (
          <>
            <strong>{items[0]?.title}</strong>
            {items[0]?.artist ? ` · ${items[0].artist}` : ''}
          </>
        )}
      </p>

      <div className={styles.section}>
        <button
          className={styles.action}
          onClick={onSaveLibrary}
          disabled={busy || allInLibrary}
        >
          <span className={styles.actionIcon}><Icon name="Library" size={16} /></span>
          <span className={styles.actionLabel}>
            {allInLibrary
              ? (multi ? 'Ya están en tu biblioteca' : 'Ya está en tu biblioteca')
              : 'Solo añadir a biblioteca'}
          </span>
        </button>
      </div>

      <div className={styles.sectionTitle}>Playlists</div>
      <ul className={styles.list}>
        {playlists.map((pl) => {
          const state = playlistState(pl);
          const checked = state === 'all';
          const partial = state === 'some';
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
                  data-partial={partial || undefined}
                  aria-hidden="true"
                >{checked
                  ? <Icon name="Check" size={14} />
                  : partial ? <Icon name="Minus" size={14} /> : null}</span>
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
export function SaveDialog({ track, tracks, onClose }) {
  const isMobile = useMobileViewport();
  const useSheet = isMobile && !isDesktop;

  const multi = Array.isArray(tracks) && tracks.length > 0;
  const title = multi ? `Guardar ${tracks.length} canciones` : 'Guardar canción';

  /* PWA mobile: empuja el SaveBody al store global; el render lo hace
     BottomSheetHost. */
  const openSheet = useBottomSheet((s) => s.open);
  const closeSheetById = useBottomSheet((s) => s.closeById);
  const sheetIdRef = useRef(null);

  useEffect(() => {
    if (!useSheet) return;
    const id = openSheet({
      title,
      content: <div className={styles.sheetBody}><SaveBody track={track} tracks={tracks} onClose={onClose} /></div>,
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
    <Modal onClose={onClose} title={title} size="sm">
      <SaveBody track={track} tracks={tracks} onClose={onClose} />
    </Modal>
  );
}
