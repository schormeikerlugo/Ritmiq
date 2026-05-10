import { create } from 'zustand';
import { api, isDesktop } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import { pullTracks, pushTrack, deleteTrackRemote } from '../lib/sync.js';
import { tryOrQueue } from '../lib/sync-queue.js';
import { isEphemeralTrack } from '../lib/track-helpers.js';
import { listLocalIds, cacheTracks, getCachedTracks } from '../lib/local-downloads.js';
import { usePlayerStore } from './player.js';

/**
 * @typedef {import('@ritmiq/core/types').Track} Track
 */

export const useLibraryStore = create((set, get) => ({
  /** @type {Track[]} */
  tracks: [],
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        set({ tracks: [], loading: false });
        return;
      }

      // PWA: hidratar primero desde Dexie para que la UI tenga contenido al instante (offline-first).
      if (!isDesktop) {
        try {
          const cached = await getCachedTracks();
          if (cached.length > 0) {
            const localIds = await listLocalIds();
            set({
              tracks: cached.map((t) => ({ ...t, isDownloaded: localIds.has(t.id), filePath: null })),
            });
          }
        } catch (e) {
          console.warn('[library] cache hidratación falló:', e?.message ?? e);
        }
      }

      let remote;
      try {
        remote = await pullTracks();
      } catch (e) {
        // Sin red: aceptar el estado hidratado de cache.
        console.info('[library] sin red — usando cache local');
        set({ loading: false });
        return;
      }

      let merged = remote;
      if (isDesktop) {
        const local = await api.libraryList(userId);
        const localById = new Map(local.map((t) => [t.id, t]));
        const byId = new Map(remote.map((t) => [t.id, t]));

        // Replicar a SQLite cualquier track remoto que no esté en local
        // (típicamente añadido desde otro dispositivo). Esto garantiza que
        // el LAN server pueda servirlo y que la descarga IPC funcione.
        for (const r of remote) {
          if (!localById.has(r.id)) {
            try { await api.librarySyncRemote(r); } catch {}
          }
        }

        for (const lt of local) {
          const r = byId.get(lt.id);
          if (r) byId.set(lt.id, { ...r, isDownloaded: lt.isDownloaded, filePath: lt.filePath });
          else byId.set(lt.id, lt);
        }
        merged = [...byId.values()].sort((a, b) =>
          (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
        );
      } else {
        // PWA: el flag is_downloaded vive en IndexedDB de este dispositivo.
        const localIds = await listLocalIds();
        merged = remote.map((t) => ({ ...t, isDownloaded: localIds.has(t.id) }));
      }

      set({ tracks: merged, loading: false });

      // PWA: persistir cache para próximo arranque offline.
      if (!isDesktop) {
        cacheTracks(remote).catch(() => {});
      }
    } catch (err) {
      set({ error: String(err?.message ?? err), loading: false });
    }
  },

  /**
   * Persiste un track efímero (resultado de búsqueda) en Supabase + SQLite local.
   * Si el reproductor está reproduciendo ese track efímero, actualiza
   * `currentTrack` con el persistido para que los botones reaccionen.
   *
   * @param {Track} track  Track efímero (id "yt:<ytId>") o un Track normal
   * @returns {Promise<Track>} Track persistido (con UUID real)
   */
  async persistEphemeral(track) {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) throw new Error('No hay sesión activa');

    if (!isEphemeralTrack(track)) {
      // Asegurar que está en remoto y local.
      await tryOrQueue(() => pushTrack(track), { kind: 'track.upsert', payload: track });
      return track;
    }

    const meta = {
      id: track.ytId ?? track.id.replace(/^yt:/, ''),
      title: track.title,
      uploader: track.artist,
      duration: track.durationSeconds,
      thumbnail: track.coverUrl,
    };

    // Tanto desktop (IPC + SQLite) como PWA (insert directo a Supabase) tienen
    // implementación válida en api.libraryAddFromMeta.
    const persisted = await api.libraryAddFromMeta({ meta, userId });

    // En desktop también empujamos a Supabase explícitamente (el IPC solo
    // toca SQLite local). En PWA ya quedó persistido por la propia función.
    if (isDesktop) {
      await tryOrQueue(() => pushTrack(persisted), { kind: 'track.upsert', payload: persisted });
    }

    set((s) => mergeTrack(s, persisted));

    // Si era el track sonando, swap del currentTrack para que el player muestre
    // los botones en estado correcto (el id pasa de efímero a UUID).
    const cur = usePlayerStore.getState().currentTrack;
    if (cur && cur.id === track.id) {
      usePlayerStore.getState().setCurrent(persisted);
    }

    return persisted;
  },

  /**
   * Añade un track desde URL/ID de YouTube. Persiste en Supabase
   * (+ SQLite local en desktop). Errores propagan al caller.
   * @param {string} idOrUrl
   */
  async addFromYoutube(idOrUrl) {
    set({ error: null });
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) throw new Error('No hay sesión activa');
    const track = await api.libraryAdd({ idOrUrl, userId });
    if (isDesktop) await pushTrack(track);
    set((s) => mergeTrack(s, track));
    return track;
  },

  /**
   * Añade un track desde metadata (resultado de búsqueda). Persiste en
   * Supabase (+ SQLite local en desktop). Idempotente: si el (user_id, yt_id)
   * ya existe, devuelve la fila existente sin duplicar.
   * Errores de red propagan; errores de duplicado se silencian.
   * @param {{id:string,title:string,uploader?:string|null,duration?:number|null,thumbnail?:string|null}} meta
   */
  async addFromMeta(meta) {
    set({ error: null });
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) throw new Error('No hay sesión activa');
    const track = await api.libraryAddFromMeta({ meta, userId });
    if (isDesktop) await pushTrack(track);
    set((s) => mergeTrack(s, track));
    return track;
  },

  /** Borra un track de la biblioteca (remoto + local). */
  async remove(trackId) {
    await tryOrQueue(
      () => deleteTrackRemote(trackId),
      { kind: 'track.delete', payload: { id: trackId } }
    );
    set((s) => ({ tracks: s.tracks.filter((t) => t.id !== trackId) }));
  },

  /**
   * Descarga al disco local (desktop) o a IndexedDB (PWA).
   * En desktop pasamos también la fila completa como fallback al IPC, así
   * el handler puede insertarla en SQLite si aún no estaba (típico tras
   * importar de Spotify).
   */
  async download(trackId) {
    if (isDesktop) {
      const t = get().tracks.find((x) => x.id === trackId);
      await api.libraryDownload(t ? { trackId, fallback: t } : trackId);
      await get().load();
      return;
    }
    await api.libraryDownload(trackId);
    await get().load();
  },

  /** Borra el archivo local de un track descargado. */
  async undownload(trackId) {
    if (!isDesktop) throw new Error('Solo desktop por ahora');
    await api.libraryUndownload(trackId);
    await get().load();
  },

  reset() {
    set({ tracks: [], error: null });
  },

  /**
   * Aplica un evento Realtime (INSERT/UPDATE/DELETE) sobre la tabla `tracks`.
   * Los campos por-dispositivo (isDownloaded/filePath) NO se sobreescriben.
   */
  applyRemote({ eventType, new: row, old }) {
    if (eventType === 'DELETE') {
      const id = old?.id;
      if (!id) return;
      set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) }));
      // Replicar borrado a SQLite local en desktop.
      if (isDesktop) api.libraryDeleteRemote(id).catch(() => {});
      return;
    }
    if (!row) return;
    const incoming = remoteRowToTrack(row);
    set((s) => {
      const idx = s.tracks.findIndex((t) => t.id === incoming.id);
      if (idx >= 0) {
        const cur = s.tracks[idx];
        const next = s.tracks.slice();
        next[idx] = {
          ...incoming,
          isDownloaded: cur.isDownloaded,
          filePath: cur.filePath,
        };
        return { tracks: next };
      }
      return { tracks: [incoming, ...s.tracks] };
    });
    // Replicar a SQLite local para que el LAN server pueda servir el track.
    if (isDesktop) api.librarySyncRemote(incoming).catch(() => {});
  },
}));

function remoteRowToTrack(r) {
  return {
    id: r.id,
    userId: r.user_id,
    source: r.source,
    ytId: r.yt_id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    durationSeconds: r.duration_seconds,
    coverUrl: r.cover_url,
    filePath: null,
    isDownloaded: false,
    createdAt: r.created_at,
  };
}

function mergeTrack(state, track) {
  const idx = state.tracks.findIndex((t) => t.id === track.id);
  if (idx >= 0) {
    const next = state.tracks.slice();
    next[idx] = track;
    return { tracks: next };
  }
  return { tracks: [track, ...state.tracks] };
}
