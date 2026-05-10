import { useMemo, useState } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useLibraryStore } from '../../stores/library.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { useDownloadsStore } from '../../stores/downloads.js';
import { DropdownMenu } from '../DropdownMenu/DropdownMenu.jsx';
import { RenameDialog } from '../RenameDialog/RenameDialog.jsx';
import { SaveDialog } from '../SaveDialog/SaveDialog.jsx';
import { TrackInfoDialog } from '../TrackInfoDialog/TrackInfoDialog.jsx';
import { CoverUploadDialog } from '../CoverUploadDialog/CoverUploadDialog.jsx';
import { exportPlaylistJson, exportPlaylistCsv } from '../../lib/export.js';
import { isDesktop } from '../../lib/api.js';
import styles from './PlaylistView.module.css';

function fmtDur(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function fmtTotalDur(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

function normalize(s) {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** @param {{ playlistId: string }} props */
export function PlaylistView({ playlistId }) {
  const playlists = usePlaylistsStore((s) => s.playlists);
  const contents = usePlaylistsStore((s) => s.contents);
  const removeTrack = usePlaylistsStore((s) => s.removeTrack);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);
  const remove = usePlaylistsStore((s) => s.remove);
  const rename = usePlaylistsStore((s) => s.rename);
  const reorder = usePlaylistsStore((s) => s.reorder);
  const setOffline = usePlaylistsStore((s) => s.setOffline);
  const toggleFavorite = usePlaylistsStore((s) => s.toggleFavorite);
  const isFavorite = usePlaylistsStore((s) => s.isFavorite);

  const allTracks = useLibraryStore((s) => s.tracks);
  const downloadOne = useLibraryStore((s) => s.download);
  const undownloadOne = useLibraryStore((s) => s.undownload);

  const playNow = usePlayerStore((s) => s.playNow);
  const playNext = usePlayerStore((s) => s.playNext);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const setShuffle = usePlayerStore((s) => s.toggleShuffle);
  const playerShuffle = usePlayerStore((s) => s.shuffle);

  const enqueueDownloads = useDownloadsStore((s) => s.enqueue);

  const goLibrary = useViewStore((s) => s.goLibrary);

  const [renameOpen, setRenameOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [saveDialogTrack, setSaveDialogTrack] = useState(null);
  const [infoTrack, setInfoTrack] = useState(null);
  const [filter, setFilter] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const playlist = playlists.find((p) => p.id === playlistId);

  const tracks = useMemo(() => {
    const ids = contents[playlistId] ?? [];
    const byId = new Map(allTracks.map((t) => [t.id, t]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }, [contents, playlistId, allTracks]);

  const filteredTracks = useMemo(() => {
    const q = normalize(filter.trim());
    if (!q) return tracks;
    return tracks.filter((t) =>
      normalize(t.title).includes(q) ||
      normalize(t.artist).includes(q) ||
      normalize(t.album).includes(q)
    );
  }, [tracks, filter]);

  const totalSeconds = tracks.reduce((acc, t) => acc + (t.durationSeconds ?? 0), 0);
  const downloadedCount = tracks.filter((t) => t.isDownloaded).length;
  const allDownloaded = tracks.length > 0 && downloadedCount === tracks.length;
  const someDownloaded = downloadedCount > 0;

  if (!playlist) {
    return (
      <section className={styles.wrap}>
        <p className={styles.muted}>Playlist no encontrada.</p>
      </section>
    );
  }

  const isFavs = playlist.id === favoritesId;
  const filtering = filter.trim().length > 0;

  const playAll = () => {
    if (filteredTracks.length === 0) return;
    if (playerShuffle) setShuffle();
    playNow(filteredTracks, 0);
  };

  const playShuffle = () => {
    if (filteredTracks.length === 0) return;
    if (!playerShuffle) setShuffle();
    const idx = Math.floor(Math.random() * filteredTracks.length);
    playNow(filteredTracks, idx);
  };

  const downloadAll = () => {
    if (!isDesktop) return;
    enqueueDownloads(tracks);
  };

  const undownloadAll = async () => {
    if (!isDesktop) return;
    const dls = tracks.filter((t) => t.isDownloaded);
    if (dls.length === 0) return;
    if (!confirm(`¿Borrar las ${dls.length} descargas locales de esta playlist?`)) return;
    for (const t of dls) {
      try { await undownloadOne(t.id); } catch {}
    }
  };

  const onRemovePlaylist = async () => {
    if (!confirm(`¿Borrar la playlist "${playlist.name}"?`)) return;
    await remove(playlist.id);
    goLibrary();
  };

  const onToggleOffline = async () => {
    const next = !playlist.isOffline;
    await setOffline(playlist.id, next);
    if (next && isDesktop) enqueueDownloads(tracks);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = tracks.findIndex((t) => t.id === active.id);
    const newIdx = tracks.findIndex((t) => t.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(tracks.map((t) => t.id), oldIdx, newIdx);
    reorder(playlist.id, reordered);
  };

  const headerMenuItems = [
    {
      id: 'rename',
      label: 'Renombrar',
      icon: '✎',
      disabled: isFavs,
      onClick: () => setRenameOpen(true),
    },
    {
      id: 'cover',
      label: playlist.coverUrl ? 'Cambiar portada' : 'Añadir portada',
      icon: '🖼',
      onClick: () => setCoverOpen(true),
    },
    {
      id: 'offline',
      label: playlist.isOffline ? 'Quitar disponible offline' : 'Hacer disponible offline',
      icon: playlist.isOffline ? '✓' : '↓',
      onClick: onToggleOffline,
    },
    {
      id: 'undlAll',
      label: 'Quitar todas las descargas',
      icon: '✕',
      disabled: !isDesktop || !someDownloaded,
      onClick: undownloadAll,
    },
    { separator: true },
    {
      id: 'expJson',
      label: 'Exportar como JSON',
      icon: '↗',
      disabled: tracks.length === 0,
      onClick: () => exportPlaylistJson(playlist, tracks),
    },
    {
      id: 'expCsv',
      label: 'Exportar como CSV',
      icon: '↗',
      disabled: tracks.length === 0,
      onClick: () => exportPlaylistCsv(playlist, tracks),
    },
    { separator: true },
    {
      id: 'remove',
      label: 'Eliminar playlist',
      icon: '🗑',
      danger: true,
      disabled: isFavs,
      onClick: onRemovePlaylist,
    },
  ];

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <button
          className={styles.cover}
          data-favs={isFavs}
          data-has-image={!!playlist.coverUrl}
          onClick={() => setCoverOpen(true)}
          aria-label="Cambiar portada"
          title="Cambiar portada"
        >
          {playlist.coverUrl ? (
            <img src={playlist.coverUrl} alt="" />
          ) : (
            <span>{isFavs ? '♥' : '♪'}</span>
          )}
        </button>
        <div className={styles.head}>
          <span className={styles.kind}>
            {playlist.isOffline ? 'Playlist · Disponible offline' : 'Playlist'}
          </span>
          <h1 className={styles.title}>{playlist.name}</h1>
          <span className={styles.count}>
            {tracks.length} {tracks.length === 1 ? 'canción' : 'canciones'}
            {totalSeconds > 0 && ` · ${fmtTotalDur(totalSeconds)}`}
            {tracks.length > 0 && (
              <span className={styles.dlBadge} data-all={allDownloaded}>
                {downloadedCount}/{tracks.length} descargadas
              </span>
            )}
          </span>
        </div>
      </header>

      <div className={styles.actions}>
        <button
          className={styles.playAll}
          onClick={playAll}
          disabled={filteredTracks.length === 0}
          aria-label="Reproducir"
        >▶</button>
        <button
          className={styles.iconAction}
          onClick={playShuffle}
          disabled={filteredTracks.length === 0}
          aria-label="Reproducir aleatorio"
          title="Reproducir aleatorio"
          data-active={playerShuffle}
        >🔀</button>
        <button
          className={styles.iconAction}
          onClick={downloadAll}
          disabled={tracks.length === 0 || allDownloaded}
          aria-label="Descargar toda la playlist"
          title={allDownloaded ? 'Todo descargado' : 'Descargar toda la playlist'}
        >↓</button>
        <DropdownMenu
          trigger="⋯"
          items={headerMenuItems}
          align="left"
          label="Más opciones de la playlist"
        />

        <div className={styles.filterWrap}>
          <input
            className={styles.filter}
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar canciones…"
          />
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className={styles.empty}>
          <p>Esta playlist está vacía. Busca una canción y guárdala aquí.</p>
        </div>
      ) : filteredTracks.length === 0 ? (
        <div className={styles.empty}>
          <p>Sin coincidencias para «{filter}».</p>
        </div>
      ) : filtering ? (
        // Lista plana sin DnD durante el filtrado (el orden mostrado no es el real).
        <ul className={styles.list}>
          {filteredTracks.map((t, i) => (
            <PlaylistRow
              key={t.id}
              track={t}
              index={tracks.findIndex((x) => x.id === t.id)}
              displayIndex={i}
              playlist={playlist}
              isFavs={isFavs}
              currentTrack={currentTrack}
              tracks={filteredTracks}
              onPlay={() => playNow(filteredTracks, i)}
              actions={{
                playNext, enqueue, toggleFavorite, isFavorite,
                downloadOne, undownloadOne, removeTrack, setSaveDialogTrack,
                setInfoTrack,
              }}
              draggable={false}
            />
          ))}
        </ul>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tracks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className={styles.list}>
              {tracks.map((t, i) => (
                <PlaylistRow
                  key={t.id}
                  track={t}
                  index={i}
                  displayIndex={i}
                  playlist={playlist}
                  isFavs={isFavs}
                  currentTrack={currentTrack}
                  tracks={tracks}
                  onPlay={() => playNow(tracks, i)}
                  actions={{
                    playNext, enqueue, toggleFavorite, isFavorite,
                    downloadOne, undownloadOne, removeTrack, setSaveDialogTrack,
                    setInfoTrack,
                  }}
                  draggable
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {renameOpen && (
        <RenameDialog
          title="Renombrar playlist"
          initialValue={playlist.name}
          onSubmit={(v) => rename(playlist.id, v)}
          onClose={() => setRenameOpen(false)}
        />
      )}

      {saveDialogTrack && (
        <SaveDialog
          track={saveDialogTrack}
          onClose={() => setSaveDialogTrack(null)}
        />
      )}

      {infoTrack && (
        <TrackInfoDialog
          track={infoTrack}
          onClose={() => setInfoTrack(null)}
        />
      )}

      {coverOpen && (
        <CoverUploadDialog
          playlist={playlist}
          onClose={() => setCoverOpen(false)}
        />
      )}
    </section>
  );
}

function PlaylistRow({
  track, displayIndex, playlist, isFavs, currentTrack, onPlay, actions, draggable,
}) {
  const playing = currentTrack?.id === track.id;
  const fav = actions.isFavorite(track.id);

  const sortable = useSortable({ id: track.id, disabled: !draggable });
  const style = draggable ? {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  } : undefined;

  const trackMenu = [
    { id: 'next',  label: 'Reproducir a continuación', icon: '⤵', onClick: () => actions.playNext(track) },
    { id: 'q',     label: 'Añadir a la cola',           icon: '☰', onClick: () => actions.enqueue(track) },
    { separator: true },
    {
      id: 'fav',
      label: fav ? 'Quitar de favoritos' : 'Añadir a favoritos',
      icon: fav ? '♥' : '♡',
      onClick: () => actions.toggleFavorite(track.id),
    },
    {
      id: 'addto', label: 'Añadir a otra playlist…', icon: '＋',
      onClick: () => actions.setSaveDialogTrack(track),
    },
    { separator: true },
    {
      id: 'dl',
      label: track.isDownloaded ? 'Quitar descarga' : 'Descargar',
      icon: track.isDownloaded ? '✕' : '↓',
      onClick: () => track.isDownloaded
        ? actions.undownloadOne(track.id)
        : actions.downloadOne(track.id),
    },
    { id: 'info', label: 'Mostrar info', icon: 'ⓘ', onClick: () => actions.setInfoTrack(track) },
    { separator: true },
    {
      id: 'remove', label: 'Quitar de esta playlist', icon: '×', danger: true,
      onClick: () => actions.removeTrack(playlist.id, track.id),
    },
  ];

  return (
    <li
      ref={draggable ? sortable.setNodeRef : undefined}
      style={style}
      className={styles.row}
      data-playing={playing}
      data-dragging={draggable ? sortable.isDragging : false}
    >
      <span
        className={styles.handle}
        {...(draggable ? sortable.attributes : {})}
        {...(draggable ? sortable.listeners : {})}
        title={draggable ? 'Arrastrar para reordenar' : ''}
      >
        {playing ? '♪' : (draggable ? '⋮⋮' : displayIndex + 1)}
      </span>
      <button
        className={styles.cell}
        onClick={onPlay}
        aria-label={`Reproducir ${track.title}`}
      >
        <div className={styles.thumb}>
          {track.coverUrl
            ? <img src={track.coverUrl} alt="" />
            : <span aria-hidden="true">♫</span>}
        </div>
        <div className={styles.meta}>
          <span className={styles.rowTitle}>{track.title}</span>
          <span className={styles.rowArtist}>{track.artist ?? '—'}</span>
        </div>
      </button>
      <span className={styles.dlIndicator}>
        {track.isDownloaded ? <span className={styles.dlOk} title="Descargada">●</span> : null}
      </span>
      <span className={styles.dur}>{fmtDur(track.durationSeconds)}</span>
      <DropdownMenu trigger="⋯" items={trackMenu} align="right" label="Opciones de la canción" />
    </li>
  );
}
