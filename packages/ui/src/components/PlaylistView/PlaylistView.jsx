import { useEffect, useMemo, useState } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor,
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
import { useJamStore } from '../../stores/jam.js';
import { toast } from '../../stores/toast.js';
import { DropdownMenu } from '../DropdownMenu/DropdownMenu.jsx';
import { RenameDialog } from '../RenameDialog/RenameDialog.jsx';
import { SaveDialog } from '../SaveDialog/SaveDialog.jsx';
import { TrackInfoDialog } from '../TrackInfoDialog/TrackInfoDialog.jsx';
import { EditTrackDialog } from '../EditTrackDialog/EditTrackDialog.jsx';
import { CoverUploadDialog } from '../CoverUploadDialog/CoverUploadDialog.jsx';
import { ConfirmDialog } from '../primitives/index.js';
import { exportPlaylistJson, exportPlaylistCsv } from '../../lib/export.js';
import { isDesktop } from '../../lib/api.js';
import { prewarmStream } from '../../lib/lan-client.js';
import { getDominantColor } from '../../lib/dominant-color.js';
import { useSocialStore } from '../../stores/social.js';
import { ShareToFriendModal } from '../ShareToFriendModal/ShareToFriendModal.jsx';
import { DownloadIndicator } from '../DownloadIndicator/DownloadIndicator.jsx';
import { Icon } from '../Icon/Icon.jsx';
import { HeroSkeleton, TrackRowSkeleton } from '../Skeleton/index.js';
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
  const playlistsLoading = usePlaylistsStore((s) => s.loading);
  const contents = usePlaylistsStore((s) => s.contents);
  const removeTrack = usePlaylistsStore((s) => s.removeTrack);
  const removeTracks = usePlaylistsStore((s) => s.removeTracks);
  const toggleFavoriteMany = usePlaylistsStore((s) => s.toggleFavoriteMany);
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
  const undownloadMany = useLibraryStore((s) => s.undownloadMany);

  const playNow = usePlayerStore((s) => s.playNow);
  const playNext = usePlayerStore((s) => s.playNext);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  // isPlaying necesario para el FAB de Play con estado activo: si la
  // playlist actual contiene el track sonando, el boton cambia de play
  // a animacion de eq + pulso (mismo patron que Library).
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const setShuffle = usePlayerStore((s) => s.toggleShuffle);
  const playerShuffle = usePlayerStore((s) => s.shuffle);

  const enqueueDownloads = useDownloadsStore((s) => s.enqueue);

  const goLibrary = useViewStore((s) => s.goLibrary);

  const [renameOpen, setRenameOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [saveDialogTrack, setSaveDialogTrack] = useState(null);
  const [infoTrack, setInfoTrack] = useState(null);
  const [editTrack, setEditTrack] = useState(null);
  const [filter, setFilter] = useState('');
  const [heroBg, setHeroBg] = useState('var(--color-bg-1)');
  const [sharePlaylistOpen, setSharePlaylistOpen] = useState(false);
  const [confirmUndownloadAll, setConfirmUndownloadAll] = useState(false);
  const [confirmRemovePlaylist, setConfirmRemovePlaylist] = useState(false);
  // Selección múltiple: Set de trackIds. selectMode activa/desactiva la UI.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [saveDialogTracks, setSaveDialogTracks] = useState(null);
  const [confirmRemoveSelected, setConfirmRemoveSelected] = useState(false);
  const friends = useSocialStore((s) => s.friends);

  // Extraer color dominante del cover para el gradiente hero (estilo Spotify).
  useEffect(() => {
    let cancelled = false;
    const cover = playlists.find((p) => p.id === playlistId)?.coverUrl;
    if (!cover) {
      setHeroBg('var(--color-bg-1)');
      return;
    }
    getDominantColor(cover).then((c) => {
      if (!cancelled) setHeroBg(c || 'var(--color-bg-1)');
    });
    return () => { cancelled = true; };
  }, [playlists, playlistId]);

  // Sensores separados por dispositivo:
  //   - Mouse: arranca con 4px de movimiento (precisa, sin delay).
  //   - Touch: long-press de 220ms con tolerancia de 6px. Esto evita
  //     que un scroll vertical normal se confunda con un drag y permite
  //     al usuario distinguir "scrollear lista" vs "mantener para mover".
  //     Antes habia un solo PointerSensor sin delay -> en mobile el
  //     navegador ganaba la gesticulacion (touch-action: manipulation)
  //     y la pagina hacia scroll antes de que dnd-kit detectara el drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const playlist = playlists.find((p) => p.id === playlistId);

  const tracks = useMemo(() => {
    const ids = contents[playlistId] ?? [];
    const byId = new Map(allTracks.map((t) => [t.id, t]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }, [contents, playlistId, allTracks]);

  // Prewarm de los primeros 3 tracks de la playlist al abrirla. yt-dlp +
  // signature solving tarda ~4s en frío; calentar el cache antes de que el
  // usuario pulse play reduce la latencia percibida a ~0. Dedup por ytId
  // dentro de `prewarmStream` (5 min) → no spamea.
  useEffect(() => {
    const ytIds = tracks.slice(0, 3).map((t) => t.ytId).filter(Boolean);
    for (const id of ytIds) prewarmStream(id);
  }, [tracks]);

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

  // ───────────────────────── SELECCIÓN MÚLTIPLE ─────────────────────────
  // Al salir del modo selección, limpiamos el Set para no arrastrar estado.
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };

  // Si la lista filtrada cambia y queda vacía, salimos del modo selección.
  useEffect(() => {
    if (selectMode && tracks.length === 0) exitSelect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.length, selectMode]);

  const toggleSelect = (trackId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const allFilteredSelected = filteredTracks.length > 0 &&
    filteredTracks.every((t) => selected.has(t.id));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (filteredTracks.length > 0 && filteredTracks.every((t) => prev.has(t.id))) {
        return new Set();
      }
      return new Set(filteredTracks.map((t) => t.id));
    });
  };

  // Tracks seleccionados resueltos (en el orden de la lista filtrada).
  const selectedTracks = useMemo(
    () => filteredTracks.filter((t) => selected.has(t.id)),
    [filteredTracks, selected],
  );
  const selectedCount = selectedTracks.length;
  const selectedAllDownloaded = selectedCount > 0 &&
    selectedTracks.every((t) => t.isDownloaded);
  const selectedAllFav = selectedCount > 0 &&
    selectedTracks.every((t) => isFavorite(t.id));

  // ── Acciones de lote ──
  const bulkPlay = () => {
    if (selectedCount === 0) return;
    playNow(selectedTracks, 0);
    exitSelect();
  };
  const bulkEnqueue = () => {
    if (selectedCount === 0) return;
    for (const t of selectedTracks) enqueue(t);
    toast.success(`${selectedCount} ${selectedCount === 1 ? 'añadida' : 'añadidas'} a la cola`, { icon: 'ListMusic' });
    exitSelect();
  };
  const bulkDownload = () => {
    if (selectedCount === 0) return;
    enqueueDownloads(selectedTracks);
    exitSelect();
  };
  const bulkUndownload = async () => {
    const ids = selectedTracks.filter((t) => t.isDownloaded).map((t) => t.id);
    if (ids.length === 0) return;
    await undownloadMany(ids);
    exitSelect();
  };
  const bulkToggleFav = async () => {
    if (selectedCount === 0) return;
    // Si todos ya son favoritos, los quitamos; si no, añadimos los que falten.
    await toggleFavoriteMany(selectedTracks.map((t) => t.id), !selectedAllFav);
    exitSelect();
  };
  const bulkAddToPlaylist = () => {
    if (selectedCount === 0) return;
    setSaveDialogTracks(selectedTracks);
  };
  const bulkRemoveFromPlaylist = async () => {
    if (selectedCount === 0) return;
    await removeTracks(playlist.id, selectedTracks.map((t) => t.id));
    exitSelect();
  };

  if (!playlist) {
    // Mientras se hidrata desde Supabase, mostrar skeleton — evita el
    // flash de "Playlist no encontrada" en cada navegacion directa.
    if (playlistsLoading) {
      return (
        <section className={styles.wrap}>
          <HeroSkeleton />
          <TrackRowSkeleton count={8} />
        </section>
      );
    }
    return (
      <section className={styles.wrap}>
        <p className={styles.muted}>Playlist no encontrada.</p>
      </section>
    );
  }

  const isFavs = playlist.id === favoritesId;
  const filtering = filter.trim().length > 0;

  // \u00bfEsta esta playlist actualmente cargada en el player?
  // Detectamos comprobando si el currentTrack.id pertenece a contents.
  // 'active'  \u2192 morado solido + eq bars.
  // 'playing' \u2192 ademas suena \u2192 anade animacion glow.
  // Comparamos contra `tracks` (no filteredTracks) porque el filtro
  // visual de busqueda no afecta lo que esta cargado en la queue.
  const playlistActive  = !!currentTrack && tracks.some((t) => t.id === currentTrack.id);
  const playlistPlaying = playlistActive && isPlaying;

  const playAll = () => {
    if (filteredTracks.length === 0) return;
    // Si ya esta sonando algo de esta playlist, el FAB actua como
    // toggle play/pause \u2014 patron Spotify. Si esta pausada, reanuda;
    // si esta sonando, pausa. Solo si NO esta activa la playlist,
    // arrancamos desde el inicio.
    if (playlistActive) {
      togglePlay();
      return;
    }
    if (playerShuffle) setShuffle();
    playNow(filteredTracks, 0);
  };

  const playShuffle = () => {
    if (filteredTracks.length === 0) return;
    if (!playerShuffle) setShuffle();
    const idx = Math.floor(Math.random() * filteredTracks.length);
    playNow(filteredTracks, idx);
  };

  const downloadAll = async () => {
    enqueueDownloads(tracks);
    // AUTO-OFFLINE: descargar toda la playlist tambien la marca como
    // disponible offline. El watcher del store auto-descarga cada track
    // nuevo que se agregue mientras este flag este activo.
    if (!playlist.isOffline) {
      try { await setOffline(playlist.id, true); } catch {}
    }
  };

  const downloadedTracks = useMemo(() => tracks.filter((t) => t.isDownloaded), [tracks]);

  const undownloadAll = () => {
    if (downloadedTracks.length === 0) return;
    setConfirmUndownloadAll(true);
  };

  const performUndownloadAll = async () => {
    for (const t of downloadedTracks) {
      try { await undownloadOne(t.id); } catch {}
    }
  };

  const onRemovePlaylist = () => setConfirmRemovePlaylist(true);

  const performRemovePlaylist = async () => {
    await remove(playlist.id);
    goLibrary();
  };

  const onToggleOffline = async () => {
    const next = !playlist.isOffline;
    await setOffline(playlist.id, next);
    if (next) enqueueDownloads(tracks);
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
      icon: <Icon name="Pencil" size={16} />,
      disabled: isFavs,
      onClick: () => setRenameOpen(true),
    },
    {
      id: 'cover',
      label: playlist.coverUrl ? 'Cambiar portada' : 'Añadir portada',
      icon: <Icon name="Upload" size={16} />,
      onClick: () => setCoverOpen(true),
    },
    {
      id: 'offline',
      label: playlist.isOffline ? 'Quitar disponible offline' : 'Hacer disponible offline',
      icon: <Icon name={playlist.isOffline ? 'Check' : 'ArrowDownToLine'} size={16} />,
      onClick: onToggleOffline,
    },
    {
      id: 'undlAll',
      label: 'Quitar todas las descargas',
      icon: <Icon name="X" size={16} />,
      disabled: !isDesktop || !someDownloaded,
      onClick: undownloadAll,
    },
    { separator: true },
    {
      id: 'share-friend',
      label: 'Compartir con amigo',
      icon: <Icon name="UserPlus" size={16} />,
      disabled: tracks.length === 0 || friends.length === 0,
      onClick: () => setSharePlaylistOpen(true),
    },
    {
      id: 'expJson',
      label: 'Exportar como JSON',
      icon: <Icon name="Share2" size={16} />,
      disabled: tracks.length === 0,
      onClick: () => exportPlaylistJson(playlist, tracks),
    },
    {
      id: 'expCsv',
      label: 'Exportar como CSV',
      icon: <Icon name="Share2" size={16} />,
      disabled: tracks.length === 0,
      onClick: () => exportPlaylistCsv(playlist, tracks),
    },
    { separator: true },
    {
      id: 'remove',
      label: 'Eliminar playlist',
      icon: <Icon name="Trash2" size={16} />,
      danger: true,
      disabled: isFavs,
      onClick: onRemovePlaylist,
    },
  ];

  // Gradiente hero: del color dominante al bg-0 (estilo Spotify).
  const heroGradient = `linear-gradient(180deg, ${heroBg} 0%, color-mix(in srgb, ${heroBg} 50%, var(--color-bg-0)) 35%, var(--color-bg-0) 80%)`;

  return (
    <section className={styles.wrap}>
      {/* HERO Spotify-style: cover centrado grande con gradiente atras
          del color dominante. Title y meta debajo. */}
      <div className={styles.hero} style={{ background: heroGradient }}>
        <button
          className={styles.heroCover}
          data-favs={isFavs}
          data-has-image={!!playlist.coverUrl}
          onClick={() => setCoverOpen(true)}
          aria-label="Cambiar portada"
          title="Cambiar portada"
        >
          {playlist.coverUrl ? (
            <img src={playlist.coverUrl} alt="" />
          ) : (
            <Icon name={isFavs ? 'Heart' : 'Music'} size={72} filled={isFavs} />
          )}
        </button>

        <div className={styles.heroMeta}>
          <span className={styles.kind}>
            {playlist.isOffline ? 'Playlist · Offline' : 'Playlist'}
          </span>
          <h1 className={styles.heroTitle}>{playlist.name}</h1>
          <p className={styles.heroSubtitle}>
            {tracks.length} {tracks.length === 1 ? 'canción' : 'canciones'}
            {totalSeconds > 0 && ` · ${fmtTotalDur(totalSeconds)}`}
          </p>
          {tracks.length > 0 && (
            <span className={styles.dlBadge} data-all={allDownloaded}>
              <Icon name={allDownloaded ? 'CheckCircle2' : 'ArrowDownToLine'} size={12} />
              {downloadedCount}/{tracks.length} descargadas
            </span>
          )}
        </div>
      </div>

      {/* Toolbar: play FAB principal + acciones secundarias + filtro.
          Mobile: filterWrap se renderiza como fila separada debajo del
          actionsBar (igual que antes — el CSS mobile usa display:block
          full-width para .filterWrap). Desktop: el CSS reagrupa todo en
          una sola fila (play izq, iconos al lado, filtro a la derecha). */}
      <div className={styles.actionsBar}>
        <button
          className={styles.playFab}
          data-active={playlistActive || undefined}
          data-playing={playlistPlaying || undefined}
          onClick={playAll}
          disabled={filteredTracks.length === 0}
          aria-label={
            playlistPlaying ? 'Pausar' :
            playlistActive  ? 'Reanudar' : 'Reproducir'
          }
        >
          {playlistPlaying ? (
            <span className={styles.fabPulseBars} aria-hidden="true">
              <span /><span /><span /><span />
            </span>
          ) : playlistActive ? (
            // Pausada pero cargada \u2014 mostramos icono de Play normal,
            // el data-active mantiene el morado mas vivido.
            <Icon name="Play" size={28} filled />
          ) : (
            <Icon name="Play" size={28} filled />
          )}
        </button>
        <div className={styles.actionsLeft}>
          <button
            className={styles.iconAction}
            data-success={allDownloaded || undefined}
            onClick={downloadAll}
            disabled={tracks.length === 0 || allDownloaded}
            aria-label="Descargar toda la playlist"
            title={allDownloaded ? 'Todo descargado' : 'Descargar toda'}
          ><Icon name={allDownloaded ? 'CheckCircle2' : 'ArrowDownToLine'} size={22} filled={allDownloaded} /></button>
          <button
            className={styles.iconAction}
            onClick={playShuffle}
            disabled={filteredTracks.length === 0}
            aria-label="Reproducir aleatorio"
            title="Reproducir aleatorio"
            data-active={playerShuffle}
          ><Icon name="Shuffle" size={22} /></button>
          <button
            className={styles.iconAction}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            disabled={tracks.length === 0}
            aria-label={selectMode ? 'Salir de selección' : 'Seleccionar canciones'}
            title={selectMode ? 'Salir de selección' : 'Seleccionar'}
            data-active={selectMode || undefined}
          ><Icon name="ListChecks" size={22} /></button>
          <DropdownMenu
            trigger={<Icon name="MoreHorizontal" size={22} />}
            items={headerMenuItems}
            align="left"
            label="Más opciones de la playlist"
          />
        </div>
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

      {selectMode && tracks.length > 0 && (
        <div className={styles.selectionBar} role="toolbar" aria-label="Acciones de selección">
          <button
            className={styles.selBarCheck}
            onClick={toggleSelectAll}
            aria-label={allFilteredSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
          >
            <span
              className={styles.selCheckbox}
              data-checked={allFilteredSelected || undefined}
              data-partial={(!allFilteredSelected && selectedCount > 0) || undefined}
              aria-hidden="true"
            >
              {allFilteredSelected
                ? <Icon name="Check" size={14} />
                : selectedCount > 0 ? <Icon name="Minus" size={14} /> : null}
            </span>
            <span className={styles.selCount}>
              {selectedCount > 0 ? `${selectedCount} seleccionadas` : 'Seleccionar todo'}
            </span>
          </button>

          <div className={styles.selActions}>
            <button className={styles.selAction} onClick={bulkPlay} disabled={selectedCount === 0} title="Reproducir" aria-label="Reproducir selección">
              <Icon name="PlayCircle" size={20} />
            </button>
            <button className={styles.selAction} onClick={bulkEnqueue} disabled={selectedCount === 0} title="Añadir a la cola" aria-label="Añadir a la cola">
              <Icon name="ListPlus" size={20} />
            </button>
            <button className={styles.selAction} onClick={bulkToggleFav} disabled={selectedCount === 0} title={selectedAllFav ? 'Quitar de favoritos' : 'Añadir a favoritos'} aria-label="Favoritos" data-active={selectedAllFav || undefined}>
              <Icon name="Heart" size={20} filled={selectedAllFav} />
            </button>
            <button className={styles.selAction} onClick={bulkAddToPlaylist} disabled={selectedCount === 0} title="Añadir a otra playlist" aria-label="Añadir a otra playlist">
              <Icon name="Plus" size={20} />
            </button>
            {selectedAllDownloaded ? (
              <button className={styles.selAction} onClick={bulkUndownload} disabled={selectedCount === 0 || !isDesktop} title="Quitar descarga" aria-label="Quitar descarga">
                <Icon name="X" size={20} />
              </button>
            ) : (
              <button className={styles.selAction} onClick={bulkDownload} disabled={selectedCount === 0} title="Descargar" aria-label="Descargar selección">
                <Icon name="ArrowDownToLine" size={20} />
              </button>
            )}
            {!isFavs && (
              <button className={styles.selAction} data-danger onClick={() => setConfirmRemoveSelected(true)} disabled={selectedCount === 0} title="Quitar de esta playlist" aria-label="Quitar de esta playlist">
                <Icon name="Trash2" size={20} />
              </button>
            )}
            <button className={styles.selAction} onClick={exitSelect} title="Cancelar" aria-label="Cancelar selección">
              <Icon name="X" size={20} />
            </button>
          </div>
        </div>
      )}

      {tracks.length === 0 ? (
        <div className={styles.empty}>
          <p>Esta playlist está vacía. Busca una canción y guárdala aquí.</p>
        </div>
      ) : filteredTracks.length === 0 ? (
        <div className={styles.empty}>
          <p>Sin coincidencias para «{filter}».</p>
        </div>
      ) : (filtering || selectMode) ? (
        // Lista plana sin DnD durante filtrado o selección múltiple
        // (el DnD entra en conflicto con la gesticulación de selección).
        <ul className={styles.list} data-selecting={selectMode || undefined}>
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
              selectMode={selectMode}
              selected={selected.has(t.id)}
              onToggleSelect={toggleSelect}
              actions={{
                playNext, enqueue, toggleFavorite, isFavorite,
                downloadOne, undownloadOne, removeTrack, setSaveDialogTrack,
                setInfoTrack, setEditTrack,
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
                    setInfoTrack, setEditTrack,
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

      {saveDialogTracks && (
        <SaveDialog
          tracks={saveDialogTracks}
          onClose={() => { setSaveDialogTracks(null); exitSelect(); }}
        />
      )}

      {infoTrack && (
        <TrackInfoDialog
          track={infoTrack}
          onClose={() => setInfoTrack(null)}
          onEdit={() => { setEditTrack(infoTrack); setInfoTrack(null); }}
        />
      )}

      {editTrack && (
        <EditTrackDialog
          track={editTrack}
          onClose={() => setEditTrack(null)}
        />
      )}

      {coverOpen && (
        <CoverUploadDialog
          playlist={playlist}
          onClose={() => setCoverOpen(false)}
        />
      )}

      {sharePlaylistOpen && playlist && tracks.length > 0 && (
        <ShareToFriendModal
          playlist={{
            id:       playlist.id,
            name:     playlist.name,
            coverUrl: playlist.coverUrl ?? null,
            tracks:   tracks.map((t) => ({
              ytId:            t.ytId ?? t.yt_id,
              title:           t.title,
              artist:          t.artist,
              coverUrl:        t.coverUrl ?? t.cover_url,
              durationSeconds: t.durationSeconds ?? t.duration_seconds,
            })),
          }}
          onClose={() => setSharePlaylistOpen(false)}
        />
      )}

      {confirmUndownloadAll && (
        <ConfirmDialog
          title="Borrar descargas de esta playlist"
          body={`Se eliminarán las ${downloadedTracks.length} descargas locales de "${playlist.name}". Las podrás volver a descargar cuando quieras.`}
          confirmLabel="Borrar descargas"
          variant="danger"
          icon="Trash2"
          onConfirm={performUndownloadAll}
          onClose={() => setConfirmUndownloadAll(false)}
        />
      )}

      {confirmRemoveSelected && (
        <ConfirmDialog
          title="Quitar de la playlist"
          body={`¿Quitar ${selectedCount} ${selectedCount === 1 ? 'canción' : 'canciones'} de "${playlist.name}"? Seguirán en tu biblioteca.`}
          confirmLabel="Quitar"
          variant="danger"
          icon="Trash2"
          onConfirm={bulkRemoveFromPlaylist}
          onClose={() => setConfirmRemoveSelected(false)}
        />
      )}

      {confirmRemovePlaylist && (
        <ConfirmDialog
          title="Eliminar playlist"
          body={`¿Seguro que quieres eliminar la playlist "${playlist.name}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          variant="danger"
          icon="AlertTriangle"
          onConfirm={performRemovePlaylist}
          onClose={() => setConfirmRemovePlaylist(false)}
        />
      )}
    </section>
  );
}

function PlaylistRow({
  track, displayIndex, playlist, isFavs, currentTrack, onPlay, actions, draggable,
  selectMode = false, selected = false, onToggleSelect,
}) {
  const playing = currentTrack?.id === track.id;
  const fav = actions.isFavorite(track.id);
  // Si hay una jam activa, ofrecemos "Sugerir a la jam" en el menu.
  const jamActive = useJamStore((s) => s.mode !== 'idle');

  const sortable = useSortable({ id: track.id, disabled: !draggable });
  const style = draggable ? {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  } : undefined;

  const trackMenu = [
    { id: 'next',  label: 'Reproducir a continuación', icon: <Icon name="CornerDownRight" size={16} />, onClick: () => actions.playNext(track) },
    { id: 'q',     label: 'Añadir a la cola',           icon: <Icon name="ListMusic" size={16} />, onClick: () => actions.enqueue(track) },
    ...(jamActive ? [{
      id: 'jam',
      label: 'Sugerir a la jam',
      icon: <Icon name="Radio" size={16} />,
      onClick: () => {
        useJamStore.getState().suggestTrack(track)
          .then(() => toast.success('Sugerida a la jam'))
          .catch((e) => toast.error(String(e?.message ?? e)));
      },
    }] : []),
    { separator: true },
    {
      id: 'fav',
      label: fav ? 'Quitar de favoritos' : 'Añadir a favoritos',
      icon: <Icon name="Heart" size={16} filled={fav} />,
      onClick: () => actions.toggleFavorite(track.id),
    },
    {
      id: 'addto', label: 'Añadir a otra playlist…', icon: <Icon name="Plus" size={16} />,
      onClick: () => actions.setSaveDialogTrack(track),
    },
    { separator: true },
    {
      id: 'dl',
      label: track.isDownloaded ? 'Quitar descarga' : 'Descargar',
      icon: <Icon name={track.isDownloaded ? 'X' : 'ArrowDownToLine'} size={16} />,
      onClick: () => track.isDownloaded
        ? actions.undownloadOne(track.id)
        : actions.downloadOne(track.id),
    },
    { id: 'info', label: 'Mostrar info', icon: <Icon name="Info" size={16} />, onClick: () => actions.setInfoTrack(track) },
    {
      id: 'edit', label: 'Editar título y artista', icon: <Icon name="Pencil" size={16} />,
      onClick: () => actions.setEditTrack(track),
    },
    { separator: true },
    {
      id: 'remove', label: 'Quitar de esta playlist', icon: <Icon name="Trash2" size={16} />, danger: true,
      onClick: () => actions.removeTrack(playlist.id, track.id),
    },
  ];

  // En modo selección, TODA la fila es el área de toque (mejor UX móvil
  // y evita que el click caiga en zonas muertas entre el thumb y el menú).
  const onRowClick = selectMode ? () => onToggleSelect?.(track.id) : undefined;

  return (
    <li
      ref={draggable ? sortable.setNodeRef : undefined}
      style={style}
      className={styles.row}
      data-playing={playing}
      data-selected={(selectMode && selected) || undefined}
      data-selecting={selectMode || undefined}
      data-dragging={draggable ? sortable.isDragging : false}
      data-draggable={draggable || undefined}
      onClick={onRowClick}
      // Listeners y attributes en TODA la fila: en touch el TouchSensor
      // (delay 220ms) discrimina long-press vs scroll; en mouse el
      // MouseSensor exige 4px de drag asi que un click normal nunca
      // activa el drag y el boton interior sigue clickable.
      // touch-action: none lo aplica dnd-kit automaticamente al activarse,
      // pero ademas lo forzamos via CSS .row[data-draggable] (override
      // del global * { touch-action: manipulation }) para que el
      // long-press se mantenga estatico sin scrollear la pagina.
      {...(draggable ? sortable.attributes : {})}
      {...(draggable ? sortable.listeners : {})}
    >
      {selectMode ? (
        <span
          className={styles.selectBox}
          data-checked={selected || undefined}
          aria-hidden="true"
        >{selected && <Icon name="Check" size={14} />}</span>
      ) : (
        <span
          className={styles.handle}
          title={draggable ? 'Mantener para reordenar' : ''}
          aria-hidden={draggable ? 'true' : undefined}
        >
          {playing ? <Icon name="Disc3" size={14} /> : (draggable ? <Icon name="MoreVertical" size={14} /> : displayIndex + 1)}
        </span>
      )}
      {selectMode ? (
        <div className={styles.cell}>
          <div className={styles.thumb}>
            {track.coverUrl
              ? <img src={track.coverUrl} alt="" loading="lazy" />
              : <Icon name="Music" size={18} />}
          </div>
          <div className={styles.meta}>
            <span className={styles.rowTitle}>{track.title}</span>
            <span className={styles.rowArtist}>{track.artist ?? '—'}</span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.cell}
          onClick={onPlay}
          aria-label={`Reproducir ${track.title}`}
        >
          <div className={styles.thumb}>
            {track.coverUrl
              ? <img src={track.coverUrl} alt="" loading="lazy" />
              : <Icon name="Music" size={18} />}
          </div>
          <div className={styles.meta}>
            <span className={styles.rowTitle} data-marquee={playing || undefined}>
              {playing ? (
                <span className={styles.marqueeTrack}>
                  <span className={styles.marqueeText}>{track.title}</span>
                  <span className={styles.marqueeText} aria-hidden="true">{track.title}</span>
                </span>
              ) : track.title}
            </span>
            <span className={styles.rowArtist}>{track.artist ?? '—'}</span>
          </div>
        </button>
      )}
      {selectMode ? (
        <span className={styles.dlIndicator} data-downloaded={track.isDownloaded || undefined} title={track.isDownloaded ? 'Descargada y disponible offline' : undefined} aria-hidden="true">
          {track.isDownloaded && <Icon name="CheckCircle2" size={14} filled />}
        </span>
      ) : (
        <DownloadIndicator trackId={track.id} isDownloaded={track.isDownloaded} className={styles.dlIndicator} />
      )}
      {!selectMode && (
        <DropdownMenu trigger={<Icon name="MoreHorizontal" size={18} />} items={trackMenu} align="right" label="Opciones de la canción" />
      )}
    </li>
  );
}
