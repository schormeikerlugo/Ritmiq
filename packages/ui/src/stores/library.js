import { create } from 'zustand';
import { api, isDesktop } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import { pullTracks, pushTrack, deleteTrackRemote } from '../lib/sync.js';
import { tryOrQueue } from '../lib/sync-queue.js';
import { isEphemeralTrack } from '../lib/track-helpers.js';
import { listLocalIds, cacheTracks, getCachedTracks } from '../lib/local-downloads.js';
import { publishMyMetaEdit } from '../lib/publish-meta-edit.js';
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

    // Si era el track sonando, hacemos un swap de identidad SIN reiniciar
    // la reproducción: patch directo en currentTrack + reemplazo en la cola
    // si está presente. `setCurrent` (= playNow) resetearía isPlaying y
    // positionSeconds — eso causaba que la canción "se pausara y se
    // volviera a repetir" al guardar en playlist.
    const playerState = usePlayerStore.getState();
    const cur = playerState.currentTrack;
    if (cur && cur.id === track.id) {
      const newQueue = playerState.queue.map((t) => (t.id === track.id ? persisted : t));
      playerState.patch({ currentTrack: persisted, queue: newQueue });
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
   * Encola la descarga a través de `useDownloadsStore`. Esto unifica el
   * comportamiento desktop/PWA y SIEMPRE muestra la barra de progreso
   * (DownloadProgress) y el spinner por fila — clave en PWA donde la
   * descarga es lenta porque pasa por IndexedDB.
   */
  async download(trackId) {
    const t = get().tracks.find((x) => x.id === trackId);
    if (!t) return;
    // import dinámico para evitar ciclo library ↔ downloads.
    const { useDownloadsStore } = await import('./downloads.js');
    useDownloadsStore.getState().enqueue([t]);
  },

  /** Borra el archivo local (desktop) o el blob de IndexedDB (PWA). */
  async undownload(trackId) {
    await api.libraryUndownload(trackId);
    await get().load();
  },

  /**
   * Edita metadata de un track existente (title, artist, album).
   *
   * Aplica los cambios en este orden para que la UX sea instantánea:
   *   1. OPTIMISTIC: actualiza el store local + currentTrack + queue.
   *   2. Persiste a Supabase via pushTrack (con tryOrQueue offline).
   *   3. En desktop: replica a SQLite local via IPC library:update.
   *   4. Fire-and-forget: contribuye al cache global tracks_global
   *      con los valores corregidos. Si era el primer humano publicando
   *      ese ytId, su edición se vuelve canónica (first-write-wins).
   *      Si ya estaba canonizado, solo incrementa contribution_count.
   *
   * Side effects en el player:
   *   - currentTrack se reemplaza si coincide id (refresca Player bar y
   *     NowPlaying view).
   *   - queue.map para reemplazar cualquier ocurrencia del id.
   *   - MediaSession.metadata se refresca via applyMediaSessionMetadata
   *     del player engine (se dispara automaticamente al cambiar
   *     currentTrack en el useEffect[currentTrack] de use-player).
   *
   * @param {string} trackId
   * @param {{title?: string, artist?: string|null, album?: string|null}} patch
   * @returns {Promise<import('@ritmiq/core').Track>}  Track actualizado.
   */
  async updateMeta(trackId, patch) {
    if (!trackId) throw new Error('trackId requerido');
    if (!patch || typeof patch !== 'object') throw new Error('patch invalido');

    const current = get().tracks.find((t) => t.id === trackId);
    if (!current) throw new Error('Track no encontrado en biblioteca');

    // Sanitizar patch: trim + null para vacios opcionales.
    const cleanPatch = {};
    if (typeof patch.title === 'string') {
      const t = patch.title.trim();
      if (!t) throw new Error('El titulo no puede estar vacio');
      cleanPatch.title = t.slice(0, 500);
    }
    if (patch.artist !== undefined) {
      const a = typeof patch.artist === 'string' ? patch.artist.trim() : null;
      cleanPatch.artist = a ? a.slice(0, 500) : null;
    }
    if (patch.album !== undefined) {
      const al = typeof patch.album === 'string' ? patch.album.trim() : null;
      cleanPatch.album = al ? al.slice(0, 500) : null;
    }

    // Si no hubo cambios reales, no-op.
    const hasChange = Object.entries(cleanPatch).some(
      ([k, v]) => current[k] !== v,
    );
    if (!hasChange) return current;

    const next = { ...current, ...cleanPatch };

    // 1. OPTIMISTIC: actualizar store local INMEDIATAMENTE.
    set((s) => {
      const idx = s.tracks.findIndex((t) => t.id === trackId);
      if (idx < 0) return s;
      const arr = s.tracks.slice();
      arr[idx] = next;
      return { tracks: arr };
    });

    // 2. Sincronizar player state: currentTrack + queue. Esto refresca
    //    la barra del Player, NowPlaying y dispara MediaSession update
    //    via el useEffect[currentTrack] en use-player.
    const playerState = usePlayerStore.getState();
    const playerPatch = {};
    if (playerState.currentTrack?.id === trackId) {
      playerPatch.currentTrack = next;
    }
    if (Array.isArray(playerState.queue) && playerState.queue.some((t) => t.id === trackId)) {
      playerPatch.queue = playerState.queue.map((t) => (t.id === trackId ? next : t));
    }
    if (Object.keys(playerPatch).length > 0) {
      playerState.patch(playerPatch);
    }

    // 3. Persistir a Supabase (RLS owner-only). El UPDATE viaja por
    //    Realtime a otros devices del mismo user automaticamente.
    await tryOrQueue(
      () => pushTrack(next),
      { kind: 'track.upsert', payload: next },
    );

    // 4. Replicar a SQLite local en desktop via IPC dedicado.
    if (isDesktop && typeof api.libraryUpdate === 'function') {
      try { await api.libraryUpdate(trackId, cleanPatch); } catch (err) {
        console.warn('[library.updateMeta] SQLite update failed (no fatal):', err?.message);
      }
    }

    // 5. Contribuir al diccionario global. Fire-and-forget; si era el
    //    primer humano publicando ese ytId, su edicion se canoniza para
    //    futuros usuarios. Si ya estaba canonizado, solo incrementa
    //    counter (anti-spam por diseño).
    if (next.ytId && next.title && next.artist) {
      publishMyMetaEdit(next).catch(() => {});
    }

    return next;
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
