import { create } from 'zustand';
import { api, isDesktop } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import {
  pullPlaylists, pushPlaylist, deletePlaylistRemote,
  pullPlaylistContents, pushPlaylistTrack, removePlaylistTrackRemote,
  reorderPlaylistRemote,
} from '../lib/sync.js';
import { tryOrQueue } from '../lib/sync-queue.js';
import { randomId } from '../lib/id.js';
import { useLibraryStore } from './library.js';
import { useDownloadsStore } from './downloads.js';
import {
  cachePlaylists, cachePlaylistContents,
  getCachedPlaylists, getCachedPlaylistContents,
} from '../lib/local-downloads.js';
import { toast } from './toast.js';

function enqueueOfflineDownload(trackId) {
  try {
    const t = useLibraryStore.getState().tracks.find((x) => x.id === trackId);
    if (t && !t.isDownloaded) {
      useDownloadsStore.getState().enqueue([t]);
    }
  } catch {}
}

/**
 * @typedef {import('@ritmiq/core/types').Playlist} Playlist
 */

const FAVS_NAME = 'Favoritas';

export const usePlaylistsStore = create((set, get) => ({
  /** @type {Playlist[]} */
  playlists: [],
  /** id de la playlist 'Favoritas' */
  favoritesId: null,
  /** @type {Record<string,string[]>}  trackIds por playlistId */
  contents: {},
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        set({ playlists: [], favoritesId: null, contents: {}, loading: false });
        return;
      }

      // ── 1. HIDRATAR desde Dexie inmediatamente (offline-first) ──
      // Si no hay red, este es el único origen de datos y la app sigue usable.
      if (!isDesktop) {
        try {
          const [cachedPls, cachedContents] = await Promise.all([
            getCachedPlaylists(),
            getCachedPlaylistContents(),
          ]);
          if (cachedPls.length > 0) {
            const favs = cachedPls.find((p) => p.name === FAVS_NAME);
            set({
              playlists: cachedPls,
              favoritesId: favs?.id ?? null,
              contents: cachedContents,
            });
          }
        } catch (e) {
          console.warn('[playlists] cache hidratación falló:', e?.message ?? e);
        }
      }

      // ── 2. PULL desde Supabase y refrescar cache ──
      let remote, contents;
      try {
        remote = await pullPlaylists();
        contents = await pullPlaylistContents();
      } catch (e) {
        // Sin internet: nos quedamos con lo hidratado de Dexie.
        console.info('[playlists] sin red — usando cache local');
        set({ loading: false });
        return;
      }

      // Asegurar 'Favoritas'
      let favs = remote.find((p) => p.name === FAVS_NAME);
      if (!favs) {
        favs = {
          id: randomId(),
          userId,
          name: FAVS_NAME,
          isOffline: false,
          coverUrl: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        try {
          await pushPlaylist(favs);
          if (isDesktop) await api.playlistsUpsert(favs);
          remote.unshift(favs);
        } catch (err) {
          // Si falla por FK (auth.users sin la fila), la sesión es inválida
          // → sign out automático para que el usuario vuelva a registrarse.
          const code = err?.code ?? err?.details ?? '';
          if (String(code).includes('23503') || String(err?.message ?? '').includes('foreign key')) {
            console.warn('[playlists] sesión inválida, cerrando sesión');
            await supabase.auth.signOut();
            set({ playlists: [], favoritesId: null, contents: {}, loading: false, error: 'Sesión expirada. Vuelve a iniciar sesión.' });
            return;
          }
          throw err;
        }
      }

      // Replicar a SQLite local en desktop
      if (isDesktop) {
        for (const p of remote) await api.playlistsUpsert(p);
      }

      set({
        playlists: remote,
        favoritesId: favs.id,
        contents,
        loading: false,
      });

      // Persistir cache para próximo arranque offline.
      if (!isDesktop) {
        cachePlaylists(remote).catch(() => {});
        cachePlaylistContents(contents).catch(() => {});
      }
    } catch (err) {
      set({ error: String(err?.message ?? err), loading: false });
    }
  },

  /** Crea una playlist nueva. */
  async create(name) {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) throw new Error('No hay sesión');
    const now = new Date().toISOString();
    /** @type {Playlist} */
    const p = {
      id: randomId(),
      userId,
      name,
      isOffline: false,
      coverUrl: null,
      createdAt: now,
      updatedAt: now,
    };
    await tryOrQueue(() => pushPlaylist(p), { kind: 'playlist.upsert', payload: p });
    if (isDesktop) await api.playlistsUpsert(p);
    set((s) => ({ playlists: [...s.playlists, p] }));
    toast.success(`Playlist "${name}" creada`, { icon: 'ListMusic' });
    return p;
  },

  async rename(id, name) {
    const cur = get().playlists.find((p) => p.id === id);
    if (!cur) return;
    const next = { ...cur, name, updatedAt: new Date().toISOString() };
    await tryOrQueue(() => pushPlaylist(next), { kind: 'playlist.upsert', payload: next });
    if (isDesktop) await api.playlistsUpsert(next);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? next : p)) }));
    toast.show({ message: `Renombrada a "${name}"`, icon: 'Pencil' });
  },

  async setOffline(id, isOffline) {
    const cur = get().playlists.find((p) => p.id === id);
    if (!cur) return;
    const next = { ...cur, isOffline, updatedAt: new Date().toISOString() };
    await tryOrQueue(() => pushPlaylist(next), { kind: 'playlist.upsert', payload: next });
    if (isDesktop) await api.playlistsUpsert(next);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? next : p)) }));
    toast.show({
      message: isOffline
        ? `"${cur.name}" se descargará para offline`
        : `"${cur.name}" ya no estará offline`,
      icon: isOffline ? 'ArrowDownToLine' : 'Cloud',
    });
  },

  async setCover(id, coverUrl) {
    const cur = get().playlists.find((p) => p.id === id);
    if (!cur) return;
    const next = { ...cur, coverUrl, updatedAt: new Date().toISOString() };
    await tryOrQueue(() => pushPlaylist(next), { kind: 'playlist.upsert', payload: next });
    if (isDesktop) await api.playlistsUpsert(next);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? next : p)) }));
    toast.success(
      coverUrl ? 'Portada actualizada' : 'Portada eliminada',
      { icon: coverUrl ? 'Check' : 'Trash2' },
    );
  },

  async remove(id) {
    if (id === get().favoritesId) throw new Error('No se puede borrar Favoritas');
    const cur = get().playlists.find((p) => p.id === id);
    await tryOrQueue(() => deletePlaylistRemote(id), { kind: 'playlist.delete', payload: { id } });
    if (isDesktop) await api.playlistsDelete(id);
    set((s) => {
      const { [id]: _, ...rest } = s.contents;
      return { playlists: s.playlists.filter((p) => p.id !== id), contents: rest };
    });
    toast.show({
      message: cur ? `Playlist "${cur.name}" eliminada` : 'Playlist eliminada',
      icon: 'Trash2',
    });
  },

  /** Añade un track a una playlist (idempotente). */
  async addTrack(playlistId, trackId) {
    const list = get().contents[playlistId] ?? [];
    if (list.includes(trackId)) return;
    const position = list.length;
    try {
      await tryOrQueue(
        () => pushPlaylistTrack(playlistId, trackId, position),
        { kind: 'playlist_track.add', payload: { playlistId, trackId, position } }
      );
    } catch (err) {
      // 409 (duplicate / FK race entre workers paralelos). Si el track ya
      // estaba o si el FK aún no resolvió, lo absorbemos como no-op
      // — la siguiente sincronización lo resolverá.
      const msg = String(err?.message ?? err ?? '');
      if (!msg.match(/duplicate|conflict|409/i)) throw err;
    }
    if (isDesktop) {
      try { await api.playlistsAddTrack({ playlistId, trackId }); } catch {}
    }
    set((s) => ({
      contents: { ...s.contents, [playlistId]: [...(s.contents[playlistId] ?? []), trackId] },
    }));

    // Toast — distingue Favoritas del resto de playlists.
    const pl = get().playlists.find((p) => p.id === playlistId);
    const isFavs = playlistId === get().favoritesId;
    toast.success(
      isFavs ? 'Añadida a Favoritas' : `Añadida a "${pl?.name ?? 'la playlist'}"`,
      { icon: isFavs ? 'Heart' : 'Check' },
    );

    // Si la playlist es offline, encolar descarga del track recien anadido.
    // Funciona tanto en desktop (IPC) como en PWA (IndexedDB blob).
    // (carga lazy para evitar ciclo: playlists -> library -> playlists)
    if (pl?.isOffline) {
      enqueueOfflineDownload(trackId);
    }
  },

  async removeTrack(playlistId, trackId) {
    await tryOrQueue(
      () => removePlaylistTrackRemote(playlistId, trackId),
      { kind: 'playlist_track.remove', payload: { playlistId, trackId } }
    );
    if (isDesktop) await api.playlistsRemoveTrack({ playlistId, trackId });
    set((s) => ({
      contents: {
        ...s.contents,
        [playlistId]: (s.contents[playlistId] ?? []).filter((id) => id !== trackId),
      },
    }));

    const pl = get().playlists.find((p) => p.id === playlistId);
    const isFavs = playlistId === get().favoritesId;
    toast.show({
      message: isFavs ? 'Quitada de Favoritas' : `Quitada de "${pl?.name ?? 'la playlist'}"`,
      icon: isFavs ? 'Heart' : 'Check',
    });
  },

  /**
   * Reordena las pistas de una playlist (drag & drop).
   * Aplica optimistic update y persiste local + remoto.
   * @param {string} playlistId
   * @param {string[]} orderedTrackIds
   */
  async reorder(playlistId, orderedTrackIds) {
    // Optimistic
    set((s) => ({
      contents: { ...s.contents, [playlistId]: orderedTrackIds.slice() },
    }));
    try {
      if (isDesktop) await api.playlistsReorder({ playlistId, orderedTrackIds });
      await tryOrQueue(
        () => reorderPlaylistRemote(playlistId, orderedTrackIds),
        { kind: 'playlist_track.reorder', payload: { playlistId, orderedTrackIds } }
      );
    } catch (err) {
      console.error('[reorder] failed', err);
      // Reload contents on error to restore canonical order
      try {
        const fresh = await pullPlaylistContents();
        set({ contents: fresh });
      } catch {}
    }
  },

  /** Toggle favorito sobre un track ya persistido. */
  async toggleFavorite(trackId) {
    const { favoritesId, contents } = get();
    if (!favoritesId) return;
    const isFav = (contents[favoritesId] ?? []).includes(trackId);
    if (isFav) await get().removeTrack(favoritesId, trackId);
    else await get().addTrack(favoritesId, trackId);
  },

  isFavorite(trackId) {
    const { favoritesId, contents } = get();
    if (!favoritesId) return false;
    return (contents[favoritesId] ?? []).includes(trackId);
  },

  reset() {
    set({ playlists: [], favoritesId: null, contents: {}, error: null });
  },

  /**
   * Aplica un evento Realtime sobre la tabla `playlists`.
   * @param {{eventType:'INSERT'|'UPDATE'|'DELETE', new:any, old:any}} ev
   */
  applyRemotePlaylist({ eventType, new: row, old }) {
    if (eventType === 'DELETE') {
      const id = old?.id;
      if (!id) return;
      set((s) => {
        const { [id]: _drop, ...rest } = s.contents;
        return {
          playlists: s.playlists.filter((p) => p.id !== id),
          contents: rest,
          favoritesId: s.favoritesId === id ? null : s.favoritesId,
        };
      });
      if (isDesktop) api.playlistsDelete(id).catch(() => {});
      return;
    }
    if (!row) return;
    const incoming = remoteRowToPlaylist(row);
    set((s) => {
      const idx = s.playlists.findIndex((p) => p.id === incoming.id);
      let playlists;
      if (idx >= 0) {
        const next = s.playlists.slice();
        next[idx] = incoming;
        playlists = next;
      } else {
        playlists = [...s.playlists, incoming];
      }
      const favs = playlists.find((p) => p.name === 'Favoritas');
      return { playlists, favoritesId: favs?.id ?? s.favoritesId };
    });
    if (isDesktop) api.playlistsUpsert(incoming).catch(() => {});
  },

  /**
   * Aplica un evento Realtime sobre `playlist_tracks`.
   * @param {{eventType:'INSERT'|'UPDATE'|'DELETE', new:any, old:any}} ev
   */
  applyRemotePlaylistTrack({ eventType, new: row, old }) {
    if (eventType === 'DELETE') {
      const playlistId = old?.playlist_id;
      const trackId = old?.track_id;
      if (!playlistId || !trackId) return;
      set((s) => ({
        contents: {
          ...s.contents,
          [playlistId]: (s.contents[playlistId] ?? []).filter((id) => id !== trackId),
        },
      }));
      if (isDesktop) api.playlistsRemoveTrack({ playlistId, trackId }).catch(() => {});
      return;
    }
    if (!row) return;
    const { playlist_id: pid, track_id: tid, position } = row;
    set((s) => {
      const cur = s.contents[pid] ?? [];
      const without = cur.filter((id) => id !== tid);
      const idx = Math.max(0, Math.min(position ?? without.length, without.length));
      const next = [...without.slice(0, idx), tid, ...without.slice(idx)];
      return { contents: { ...s.contents, [pid]: next } };
    });

    if (isDesktop && eventType === 'INSERT') {
      api.playlistsAddTrack({ playlistId: pid, trackId: tid }).catch(() => {});
    }

    // Si la playlist tiene modo offline activado, encolar descarga del nuevo
    // track también en este dispositivo (smart download).
    if (eventType === 'INSERT') {
      const pl = get().playlists.find((p) => p.id === pid);
      if (pl?.isOffline) enqueueOfflineDownload(tid);
    }
  },
}));

function remoteRowToPlaylist(r) {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    isOffline: !!r.is_offline,
    coverUrl: r.cover_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
