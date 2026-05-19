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
import { useHistoryStore, selectTopArtists } from '../../stores/history.js';
import { DropdownMenu } from '../DropdownMenu/DropdownMenu.jsx';
import { SpotifyImportDialog } from '../SpotifyImportDialog/SpotifyImportDialog.jsx';
import { Icon } from '../Icon/Icon.jsx';
import { SpotifyIcon } from '../Icon/SpotifyIcon.jsx';
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
  const playlists = usePlaylistsStore((s) => s.playlists);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);
  const events = useHistoryStore((s) => s.events);
  const playNow = usePlayerStore((s) => s.playNow);
  const goPlaylist = useViewStore((s) => s.goPlaylist);
  const goArtist = useViewStore((s) => s.goArtist);
  const goAccount = useViewStore((s) => s.goAccount);
  const user = useAuthStore((s) => s.user);

  const [filter, setFilter] = useState('playlists');
  const [sort, setSort] = useState('recent');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => { loadLib(); }, [loadLib]);

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
      const dl = tracks.filter((t) => t.isDownloaded);
      for (const t of dl) {
        list.push({
          kind: 'track',
          id: `tr:${t.id}`,
          rawId: t.id,
          title: t.title,
          subtitle: `Canción descargada · ${t.artist ?? '—'}`,
          coverUrl: t.coverUrl,
          track: t,
          updatedAt: t.createdAt,
        });
      }
    }

    return list;
  }, [filter, playlists, favoritesId, events, tracks]);

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

  const onItemClick = (item) => {
    if (item.kind === 'playlist') goPlaylist(item.rawId);
    else if (item.kind === 'artist') goArtist(item.rawId);
    else if (item.kind === 'track') playNow(tracks.filter((t) => t.isDownloaded), tracks.filter((t) => t.isDownloaded).findIndex((t) => t.id === item.rawId));
  };

  const initial = (user?.email ?? 'U').slice(0, 1).toUpperCase();

  return (
    <section className={styles.wrap}>
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
      </div>

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
      </div>

      {/* Empty state grande con CTA cuando la biblioteca esta vacia.
          Solo se muestra cuando el filtro es 'all'/'playlists' Y no hay
          playlists todavia — invita al user a importar de Spotify. */}
      {sorted.length === 0 && (filter === 'playlists') && playlists.length === 0 && (
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
          <li className={styles.empty}>
            <Icon name="Music" size={40} />
            <p>No hay items en esta categoría.</p>
          </li>
        )}
        {sorted.map((item) => (
          <li key={item.id} className={styles.row}>
            <button
              type="button"
              className={styles.rowBtn}
              onClick={() => onItemClick(item)}
            >
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
              </div>
              <div className={styles.meta}>
                <span className={styles.rowTitle}>{item.title}</span>
                <span className={styles.rowSub}>{item.subtitle}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {importOpen && (
        <SpotifyImportDialog onClose={() => setImportOpen(false)} />
      )}
    </section>
  );
}
