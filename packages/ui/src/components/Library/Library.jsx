/**
 * Library Spotify-style.
 *
 * Header: avatar (→ Cuenta) + título + búsqueda + agregar.
 * Filter chips: Todo · Playlists · Artistas · Descargados.
 * Sort: Recientes · A-Z · Más reproducidos.
 * Lista unificada de items (playlist | artist | track-downloaded) con cover
 * 56px + nombre + meta line tipo "Playlist · autor".
 *
 * Click en playlist → PlaylistView. Click en artista → ArtistView.
 * Click en track-downloaded → reproduce.
 *
 * @module @ritmiq/ui/components/Library/Library
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/auth.js';
import { useLibraryStore } from '../../stores/library.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { useDownloadsStore } from '../../stores/downloads.js';
import { useHistoryStore, selectTopArtists } from '../../stores/history.js';
import { toast } from '../../stores/toast.js';
import { DropdownMenu } from '../DropdownMenu/DropdownMenu.jsx';
import { SpotifyImportDialog } from '../SpotifyImportDialog/SpotifyImportDialog.jsx';
import { SaveDialog } from '../SaveDialog/SaveDialog.jsx';
import { Icon } from '../Icon/Icon.jsx';
import { SpotifyIcon } from '../Icon/SpotifyIcon.jsx';
import { TrackRowSkeleton } from '../Skeleton/index.js';
import { ConfirmDialog, EmptyState } from '../primitives/index.js';
import { playPlaylist, playArtistFromLibrary } from '../../lib/play-helpers.js';
import { usePullToRefresh } from '../../lib/use-pull-to-refresh.js';
import { PullIndicator } from '../PullToRefresh/PullToRefresh.jsx';
import { useDownloadsStats } from '../../lib/use-downloads-stats.js';
import { DownloadsSummary, fmtBytes } from '../Downloads/DownloadsSummary.jsx';
import { isDesktop } from '../../lib/api.js';
import styles from './Library.module.css';

const FILTERS = [
  { id: 'playlists',   label: 'Playlists' },
  { id: 'artists',     label: 'Artistas' },
  { id: 'downloaded',  label: 'Descargados' },
];

const SORTS = [
  { id: 'recent',  label: 'Recientes' },
  { id: 'alpha',   label: 'A–Z' },
  { id: 'plays',   label: 'Más reproducidos' },
];

export function Library() {
  const tracks = useLibraryStore((s) => s.tracks);
  const loadLib = useLibraryStore((s) => s.load);
  const libLoading = useLibraryStore((s) => s.loading);
  const plsLoading = usePlaylistsStore((s) => s.loading);
  const loadPlaylists = usePlaylistsStore((s) => s.load);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);
  const contents = usePlaylistsStore((s) => s.contents);
  const events = useHistoryStore((s) => s.events);
  const playNow = usePlayerStore((s) => s.playNow);
  // Track actual + playing flag para resaltar el play overlay de la
  // playlist activa (morado + pulso). Si pause, el overlay queda
  // morado pero sin animacion \u2014 reanudable con un tap.
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying    = usePlayerStore((s) => s.isPlaying);
  const goPlaylist = useViewStore((s) => s.goPlaylist);
  const goArtist = useViewStore((s) => s.goArtist);
  const goAccount = useViewStore((s) => s.goAccount);
  const user = useAuthStore((s) => s.user);
  const enqueueTrack = usePlayerStore((s) => s.enqueue);
  const enqueueDownloads = useDownloadsStore((s) => s.enqueue);
  const undownloadMany = useLibraryStore((s) => s.undownloadMany);
  const removeMany = useLibraryStore((s) => s.removeMany);

  const [filter, setFilter] = useState('playlists');
  const [sort, setSort] = useState('recent');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Selección múltiple — solo aplica al filtro "Descargados".
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [saveDialogTracks, setSaveDialogTracks] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Estadísticas de descargas (nº + peso) para mostrar el resumen cuando el
  // filtro activo es "Descargados". Mismo hook que la vista Downloads.
  const downloadsStats = useDownloadsStats();

  useEffect(() => { loadLib(); }, [loadLib]);

  // Pull-to-refresh: recarga libreria + playlists desde Supabase. Solo
  // activo en mobile (max-width:768px); hook devuelve {} en desktop.
  const { bind: ptrBind, pullDistance, refreshing } = usePullToRefresh({
    onRefresh: async () => {
      await Promise.allSettled([loadLib(), loadPlaylists()]);
    },
  });

  // Build unified items list.
  const items = useMemo(() => {
    const list = [];

    // Playlists.
    if (filter === 'playlists') {
      for (const pl of playlists) {
        list.push({
          kind: 'playlist',
          id: `pl:${pl.id}`,
          rawId: pl.id,
          title: pl.name,
          subtitle: pl.id === favoritesId ? 'Playlist · Tus favoritas' : 'Playlist',
          coverUrl: pl.coverUrl,
          isFavorites: pl.id === favoritesId,
          updatedAt: pl.updatedAt ?? pl.createdAt,
        });
      }
    }

    // Top artistas (del historial — los más escuchados últimos 90 días).
    if (filter === 'artists') {
      const topArt = selectTopArtists(events, { days: 90, limit: 40 });
      for (const a of topArt) {
        list.push({
          kind: 'artist',
          id: `ar:${a.artist}`,
          rawId: a.artist,
          title: a.artist,
          subtitle: `Artista · ${a.playCount} reproducciones`,
          coverUrl: a.coverUrl ?? null,
          plays: a.playCount,
          updatedAt: a.seedTrack?.createdAt ?? null,
        });
      }
    }

    // Descargados.
    if (filter === 'downloaded') {
      const dl = tracks.filter((t) =>
        isDesktop ? t.isDownloaded : downloadsStats.sizeByTrack[t.id] != null
      );
      for (const t of dl) {
        const size = downloadsStats.sizeByTrack[t.id] ?? 0;
        const sizeLabel = size > 0 ? ` · ${fmtBytes(size)}` : '';
        list.push({
          kind: 'track',
          id: `tr:${t.id}`,
          rawId: t.id,
          title: t.title,
          subtitle: `${t.artist ?? '—'}${sizeLabel}`,
          coverUrl: t.coverUrl,
          track: t,
          updatedAt: t.createdAt,
        });
      }
    }

    return list;
  }, [filter, playlists, favoritesId, events, tracks, downloadsStats.sizeByTrack]);

  // Filtro de búsqueda (cuando search input visible).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      it.title.toLowerCase().includes(q) ||
      (it.subtitle ?? '').toLowerCase().includes(q)
    );
  }, [items, search]);

  // Sort.
  const sorted = useMemo(() => {
    const arr = filtered.slice();
    if (sort === 'alpha') {
      arr.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === 'plays') {
      arr.sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0));
    } else {
      // recent
      arr.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    }
    // Pinear "Tus favoritas" siempre al principio si esta visible.
    arr.sort((a, b) => {
      if (a.isFavorites) return -1;
      if (b.isFavorites) return 1;
      return 0;
    });
    return arr;
  }, [filtered, sort]);

  // ───────────────────── Selección múltiple (solo Descargados) ─────────────────────
  const canSelect = filter === 'downloaded';
  const selectableItems = useMemo(
    () => sorted.filter((it) => it.kind === 'track'),
    [sorted],
  );

  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };

  // Salir de selección si cambiamos de filtro o desaparecen los items.
  useEffect(() => {
    if (selectMode && (!canSelect || selectableItems.length === 0)) exitSelect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, selectableItems.length, selectMode, canSelect]);

  const toggleSelect = (trackId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const allSelected = selectableItems.length > 0 &&
    selectableItems.every((it) => selected.has(it.rawId));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (selectableItems.length > 0 && selectableItems.every((it) => prev.has(it.rawId))) {
        return new Set();
      }
      return new Set(selectableItems.map((it) => it.rawId));
    });
  };

  const selectedTracks = useMemo(
    () => selectableItems.filter((it) => selected.has(it.rawId)).map((it) => it.track),
    [selectableItems, selected],
  );
  const selectedCount = selectedTracks.length;

  const bulkPlay = () => {
    if (selectedCount === 0) return;
    playNow(selectedTracks, 0);
    exitSelect();
  };
  const bulkEnqueue = () => {
    if (selectedCount === 0) return;
    for (const t of selectedTracks) enqueueTrack(t);
    toast.success(`${selectedCount} ${selectedCount === 1 ? 'añadida' : 'añadidas'} a la cola`, { icon: 'ListMusic' });
    exitSelect();
  };
  const bulkAddToPlaylist = () => {
    if (selectedCount === 0) return;
    setSaveDialogTracks(selectedTracks);
  };
  const bulkUndownload = async () => {
    if (selectedCount === 0) return;
    await undownloadMany(selectedTracks.map((t) => t.id));
    exitSelect();
  };
  const bulkRemove = async () => {
    if (selectedCount === 0) return;
    await removeMany(selectedTracks.map((t) => t.id));
    exitSelect();
  };

  const onItemClick = (item) => {
    if (selectMode && item.kind === 'track') { toggleSelect(item.rawId); return; }
    if (item.kind === 'playlist') goPlaylist(item.rawId);
    else if (item.kind === 'artist') goArtist(item.rawId);
    else if (item.kind === 'track') playNow(tracks.filter((t) => t.isDownloaded), tracks.filter((t) => t.isDownloaded).findIndex((t) => t.id === item.rawId));
  };

  // Quick-play del overlay flotante (▶). Para tracks reusa onItemClick
  // (que ya reproduce). Para playlists/artistas resuelve sus tracks y
  // arranca playback sin navegar. stopPropagation en el handler evita
  // que el click pase al boton padre que navega.
  const onQuickPlay = (e, item) => {
    e.stopPropagation();
    e.preventDefault();
    if (item.kind === 'playlist') playPlaylist(item.rawId);
    else if (item.kind === 'artist') playArtistFromLibrary(item.rawId);
    else if (item.kind === 'track') onItemClick(item);
  };

  /**
   * \u00bfEsta sonando algo de esta playlist/artista ahora mismo?
   * Para playlist: si el currentTrack.id esta en contents[plId].
   * Para artist: si currentTrack.artist coincide case-insensitive.
   * Solo importa la igualdad \u2014 'active' incluye pause (mostramos
   * morado solido) y solo 'playing' anade la animacion de pulso.
   */
  const isItemActive = (item) => {
    if (!currentTrack) return false;
    if (item.kind === 'playlist') {
      const ids = contents[item.rawId] ?? [];
      return ids.includes(currentTrack.id);
    }
    if (item.kind === 'artist') {
      const a = (currentTrack.artist ?? '').toLowerCase().trim();
      return a && a === (item.rawId ?? '').toLowerCase().trim();
    }
    if (item.kind === 'track') {
      return currentTrack.id === item.rawId;
    }
    return false;
  };

  const initial = (user?.email ?? 'U').slice(0, 1).toUpperCase();

  return (
    <section className={styles.wrap} {...ptrBind}>
      <PullIndicator pullDistance={pullDistance} refreshing={refreshing} />
      {/* Header + filtros sticky en PWA mobile (como Spotify): se quedan
          arriba al hacer scroll de la lista. En desktop el wrap completo
          tiene su propio overflow, asi que el sticky tambien aplica. */}
      <div className={styles.stickyHeader}>
        <header className={styles.header}>
          <button
            type="button"
            className={styles.avatar}
            onClick={goAccount}
            aria-label="Cuenta"
          >{initial}</button>
          <h1 className={styles.title}>Tu biblioteca</h1>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Buscar en biblioteca"
            ><Icon name="Search" size={20} /></button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setImportOpen(true)}
              aria-label="Importar de Spotify"
              title="Importar de Spotify"
            ><SpotifyIcon size={22} /></button>
          </div>
        </header>

        {searchOpen && (
          <div className={styles.searchRow}>
            <input
              autoFocus
              type="search"
              className={styles.searchInput}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en biblioteca…"
            />
            {search && (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setSearch('')}
                aria-label="Limpiar"
              ><Icon name="X" size={16} /></button>
            )}
          </div>
        )}

        <nav className={styles.chips} aria-label="Filtros">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={styles.chip}
              data-active={filter === f.id}
              onClick={() => setFilter(f.id)}
            >{f.label}</button>
          ))}
        </nav>

      <div className={styles.sortRow}>
        <DropdownMenu
          trigger={
            <span className={styles.sortTrigger}>
              <Icon name="ChevronDown" size={14} />
              <span>{SORTS.find((s) => s.id === sort)?.label}</span>
            </span>
          }
          items={SORTS.map((s) => ({
            id: s.id, label: s.label,
            onClick: () => setSort(s.id),
          }))}
          align="left"
          label="Ordenar por"
        />
        {canSelect && selectableItems.length > 0 && (
          <button
            type="button"
            className={styles.selectToggle}
            data-active={selectMode || undefined}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          >
            <Icon name="ListChecks" size={16} />
            <span>{selectMode ? 'Cancelar' : 'Seleccionar'}</span>
          </button>
        )}
      </div>
      </div>

      {selectMode && canSelect && (
        <div className={styles.selectionBar} role="toolbar" aria-label="Acciones de selección">
          <button
            className={styles.selBarCheck}
            onClick={toggleSelectAll}
            aria-label={allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
          >
            <span
              className={styles.selCheckbox}
              data-checked={allSelected || undefined}
              data-partial={(!allSelected && selectedCount > 0) || undefined}
              aria-hidden="true"
            >
              {allSelected
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
            <button className={styles.selAction} onClick={bulkAddToPlaylist} disabled={selectedCount === 0} title="Añadir a playlist" aria-label="Añadir a playlist">
              <Icon name="Plus" size={20} />
            </button>
            <button className={styles.selAction} onClick={bulkUndownload} disabled={selectedCount === 0} title="Quitar descarga" aria-label="Quitar descarga">
              <Icon name="ArrowDownToLine" size={20} />
            </button>
            <button className={styles.selAction} data-danger onClick={() => setConfirmRemove(true)} disabled={selectedCount === 0} title="Eliminar de la biblioteca" aria-label="Eliminar de la biblioteca">
              <Icon name="Trash2" size={20} />
            </button>
            <button className={styles.selAction} onClick={exitSelect} title="Cancelar" aria-label="Cancelar selección">
              <Icon name="X" size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Resumen de descargas (nº de canciones + peso) cuando el filtro
          activo es "Descargados". Visible en PWA y desktop. */}
      {filter === 'downloaded' && (
        <DownloadsSummary
          count={downloadsStats.count}
          totalSize={downloadsStats.totalSize}
          compact
        />
      )}

      {/* Skeleton mientras carga la biblioteca/playlists por primera vez.
          Sustituye el flash de "empty state" → empty state real cuando no
          hay datos pero ya termino de cargar. */}
      {(libLoading || plsLoading) && sorted.length === 0 && playlists.length === 0 && (
        <TrackRowSkeleton count={8} />
      )}

      {/* Empty state grande con CTA cuando la biblioteca esta vacia.
          Solo se muestra cuando el filtro es 'all'/'playlists' Y no hay
          playlists todavia — invita al user a importar de Spotify. */}
      {!libLoading && !plsLoading && sorted.length === 0 && (filter === 'playlists') && playlists.length === 0 && (
        <div className={styles.bigEmpty}>
          <div className={styles.bigEmptyIcon} aria-hidden="true">
            <SpotifyIcon size={64} />
          </div>
          <h2 className={styles.bigEmptyTitle}>Empieza tu biblioteca</h2>
          <p className={styles.bigEmptyText}>
            Importa tus playlists públicas de Spotify y empezá a escuchar.
            Pegá un link y nosotros encontramos las canciones en YouTube.
          </p>
          <button
            type="button"
            className={styles.bigEmptyBtn}
            onClick={() => setImportOpen(true)}
          >
            <SpotifyIcon size={16} />
            <span>Importar de Spotify</span>
          </button>
        </div>
      )}

      <ul className={styles.list}>
        {sorted.length === 0 && playlists.length > 0 && (
          <li>
            <EmptyState
              icon="Music"
              title="No hay items en esta categoría"
              subtitle="Cambia de filtro o busca contenido nuevo."
              size="sm"
            />
          </li>
        )}
        {sorted.map((item) => {
          const active  = isItemActive(item);
          const playing = active && isPlaying;
          // Solo tracks individuales son draggeables a playlists del sidebar.
          // Las rows de playlist o artist no tienen sentido como drop source.
          const draggableProps = item.kind === 'track' ? {
            draggable: true,
            onDragStart: (e) => {
              try {
                e.dataTransfer.setData('application/x-ritmiq-track', item.rawId);
                e.dataTransfer.setData('text/plain', item.title);
                e.dataTransfer.effectAllowed = 'copy';
              } catch {}
            },
          } : null;
          const selecting = selectMode && item.kind === 'track';
          const isSel = selecting && selected.has(item.rawId);
          return (
            <li
              key={item.id}
              className={styles.row}
              data-selected={isSel || undefined}
              {...(selecting ? {} : (draggableProps ?? {}))}
            >
            <button
              type="button"
              className={styles.rowBtn}
              onClick={() => onItemClick(item)}
              aria-pressed={selecting ? isSel : undefined}
            >
              {selecting && (
                <span
                  className={styles.selectBox}
                  data-checked={isSel || undefined}
                  aria-hidden="true"
                >{isSel && <Icon name="Check" size={14} />}</span>
              )}
              <div
                className={styles.cover}
                data-shape={item.kind === 'artist' ? 'circle' : 'square'}
                data-favorites={item.isFavorites || undefined}
              >
                {item.coverUrl
                  ? <img src={item.coverUrl} alt="" loading="lazy" />
                  : <Icon
                      name={item.isFavorites ? 'Heart' : item.kind === 'artist' ? 'User' : 'Music'}
                      size={22}
                      filled={item.isFavorites}
                    />
                }
                {/* Quick-play overlay:
                      - default (mobile): semi-transparente para no tapar
                        la caratula. Hover/active en desktop sube opacidad.
                      - data-active='true' (la playlist contiene el track
                        actual): morado solido.
                      - data-playing='true' (ademas esta sonando): pulso
                        animado tipo equalizer. */}
                {!selecting && (
                  <span
                    className={styles.quickPlay}
                    data-active={active || undefined}
                    data-playing={playing || undefined}
                    role="button"
                    tabIndex={-1}
                    aria-label={`Reproducir ${item.title}`}
                    onClick={(e) => onQuickPlay(e, item)}
                  >
                    {playing
                      ? <span className={styles.pulseBars} aria-hidden="true">
                          <span /><span /><span />
                        </span>
                      : <Icon name="Play" size={14} filled />
                    }
                  </span>
                )}
              </div>
              <div className={styles.meta}>
                <span className={styles.rowTitle}>{item.title}</span>
                <span className={styles.rowSub}>{item.subtitle}</span>
              </div>
            </button>
          </li>
          );
        })}
      </ul>

      {importOpen && (
        <SpotifyImportDialog onClose={() => setImportOpen(false)} />
      )}

      {saveDialogTracks && (
        <SaveDialog
          tracks={saveDialogTracks}
          onClose={() => { setSaveDialogTracks(null); exitSelect(); }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Eliminar de la biblioteca"
          body={`¿Eliminar ${selectedCount} ${selectedCount === 1 ? 'canción' : 'canciones'} de tu biblioteca? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          variant="danger"
          icon="Trash2"
          onConfirm={bulkRemove}
          onClose={() => setConfirmRemove(false)}
        />
      )}
    </section>
  );
}
