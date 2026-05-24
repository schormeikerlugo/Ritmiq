import { create } from 'zustand';
import { lanSpotifyPlaylist } from '../lib/lan-client.js';
import { api, isDesktop } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import { randomId } from '../lib/id.js';
import { cleanYoutubeTitle } from '@ritmiq/core';
import { usePlaylistsStore } from './playlists.js';
import { useLibraryStore } from './library.js';

/**
 * @typedef {Object} ImportItem
 * @property {string} title
 * @property {string} artist
 * @property {number} durationMs
 * @property {'pending'|'matching'|'matched'|'persisted'|'error'} status
 * @property {string|null} ytId
 * @property {string|null} trackId
 * @property {string} [error]
 */

/** Mutex por yt_id: si dos workers necesitan el mismo, comparten una sola promesa. */
/** @type {Map<string, Promise<string>>} */
const persistInflight = new Map();

export const useImportStore = create((set, get) => ({
  loading: false,
  importing: false,
  done: false,
  error: null,
  /** @type {{name:string, description:string|null, coverUrl:string|null}|null} */
  source: null,
  /** @type {ImportItem[]} */
  items: [],
  createdPlaylistId: null,

  reset() {
    set({
      loading: false, importing: false, done: false, error: null,
      source: null, items: [], createdPlaylistId: null,
    });
  },

  /** @param {string} url */
  async preview(url) {
    set({ loading: true, error: null, items: [], source: null, done: false });
    try {
      const data = await lanSpotifyPlaylist(url);
      set({
        loading: false,
        source: { name: data.name, description: data.description, coverUrl: data.coverUrl },
        items: data.tracks.map((t) => /** @type {ImportItem} */ ({
          title: t.title,
          artist: t.artist,
          durationMs: t.durationMs,
          status: 'pending',
          ytId: null,
          trackId: null,
        })),
      });
    } catch (err) {
      set({ loading: false, error: String(err?.message ?? err) });
    }
  },

  async import() {
    const { source, items } = get();
    if (!source || items.length === 0) return;

    set({ importing: true, error: null, done: false });

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      set({ importing: false, error: 'No hay sesión' });
      return;
    }

    // Crear playlist destino.
    const playlist = await usePlaylistsStore.getState().create(source.name);
    set({ createdPlaylistId: playlist.id });

    const CONCURRENCY = 2;
    let cursor = 0;

    const updateItem = (i, patch) => {
      set((s) => {
        const next = s.items.slice();
        next[i] = { ...next[i], ...patch };
        return { items: next };
      });
    };

    /**
     * Persiste un track en Supabase de forma idempotente. Devuelve el track.id.
     * Mutex por yt_id para que workers paralelos compartan la misma promesa.
     *
     * @param {object} best  Resultado de YouTube (id, title, uploader, ...)
     * @param {object} item  Item original de Spotify con artist + album CONFIABLES
     */
    async function persistByYtId(best, item) {
      const ytId = best.id;

      const cached = persistInflight.get(ytId);
      if (cached) return cached;

      const promise = (async () => {
        // 1. ¿Ya existe?
        const { data: existing, error: selErr } = await supabase
          .from('tracks')
          .select('id')
          .eq('user_id', userId)
          .eq('yt_id', ytId)
          .maybeSingle();
        if (selErr) throw selErr;
        if (existing?.id) {
          // En desktop, asegurar también en SQLite local.
          if (isDesktop) {
            try { await api.librarySyncRemote(await fetchTrackFull(existing.id)); } catch {}
          }
          return existing.id;
        }

        // 2. Insertar nuevo (con id propio para evitar tener que SELECT después).
        //
        // PRIORIZAR datos de Spotify (item.artist, item.album) sobre los
        // de YouTube (best.uploader): Spotify es la fuente autoritativa
        // del playlist importado. El title se LIMPIA con la utility para
        // remover markers de YouTube ("Official Music Video", etc).
        //
        // Ver packages/core/src/clean-track-meta/.
        const cleaned = cleanYoutubeTitle({
          rawTitle: best.title,
          rawUploader: best.uploader,
        });
        const newId = randomId();
        const row = {
          id: newId,
          user_id: userId,
          source: 'youtube',
          yt_id: ytId,
          title: cleaned.title || best.title,
          // Spotify gana sobre uploader de YouTube (que suele ser "X - Topic"
          // o el nombre del sello). Solo si Spotify no nos lo da, caemos
          // a la heuristica de cleaning.
          artist: item?.artist ?? cleaned.artist ?? best.uploader ?? null,
          album: item?.album ?? null,
          duration_seconds: best.duration ?? null,
          cover_url: best.thumbnail ?? null,
          is_downloaded: false,
        };
        const { error: insErr } = await supabase.from('tracks').insert(row);
        if (insErr) {
          // Race: otro worker insertó este (user_id, yt_id) entre nuestro
          // SELECT y nuestro INSERT. Re-leemos.
          const isDup = insErr.code === '23505' || /duplicate|unique/i.test(insErr.message ?? '');
          if (!isDup) throw insErr;
          const { data: again } = await supabase
            .from('tracks').select('id')
            .eq('user_id', userId).eq('yt_id', ytId).maybeSingle();
          if (!again?.id) throw insErr;
          if (isDesktop) {
            try { await api.librarySyncRemote(await fetchTrackFull(again.id)); } catch {}
          }
          return again.id;
        }

        // En desktop: replicar a SQLite local. El renderer también lo recibirá
        // por Realtime, pero queremos que esté disponible YA para evitar 404 en
        // LAN server cuando se reproduzca.
        if (isDesktop) {
          try { await api.librarySyncRemote(await fetchTrackFull(newId)); } catch {}
        }
        return newId;
      })();

      persistInflight.set(ytId, promise);
      promise.finally(() => persistInflight.delete(ytId));
      return promise;
    }

    /** Lee la fila completa para entregar a librarySyncRemote en desktop. */
    async function fetchTrackFull(id) {
      const { data } = await supabase.from('tracks').select('*').eq('id', id).maybeSingle();
      if (!data) return { id };
      return {
        id: data.id,
        userId: data.user_id,
        source: data.source,
        ytId: data.yt_id,
        title: data.title,
        artist: data.artist,
        album: data.album,
        durationSeconds: data.duration_seconds,
        coverUrl: data.cover_url,
        filePath: null,
        isDownloaded: false,
        createdAt: data.created_at,
      };
    }

    async function worker() {
      while (cursor < items.length) {
        const idx = cursor++;
        const item = items[idx];
        try {
          updateItem(idx, { status: 'matching' });

          // Buscar en YouTube (sufijo "Topic" prioriza canales oficiales).
          const query = `${item.artist} ${item.title} Topic`;
          const results = await api.ytSearch(query);
          if (!Array.isArray(results) || results.length === 0) {
            throw new Error('Sin resultados');
          }
          const best = results.find((r) =>
            (r.uploader ?? '').toLowerCase().includes('topic')) ?? results[0];
          if (!best?.id) throw new Error('Sin id');

          updateItem(idx, { status: 'matched', ytId: best.id });

          // Persistir track (idempotente, con mutex por yt_id). Pasamos
          // item para que tenga acceso al artist + album confiables de Spotify.
          const trackId = await persistByYtId(best, item);

          // Añadir a la playlist. Tolerante a duplicados (race entre workers).
          const { error: pteErr } = await supabase
            .from('playlist_tracks')
            .upsert(
              { playlist_id: playlist.id, track_id: trackId, position: idx },
              { onConflict: 'playlist_id,track_id' }
            );
          if (pteErr) {
            const isDup = pteErr.code === '23505' || /duplicate/i.test(pteErr.message ?? '');
            if (!isDup) throw pteErr;
          }

          updateItem(idx, { status: 'persisted', trackId });
        } catch (err) {
          console.warn('[import] track failed', item.title, err);
          updateItem(idx, { status: 'error', error: String(err?.message ?? err) });
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Refrescar biblioteca para que aparezcan los tracks recién persistidos.
    try { await useLibraryStore.getState().load(); } catch {}

    set({ importing: false, done: true });
  },
}));
