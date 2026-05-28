/**
 * Store de la página de artista (Fase B).
 *
 * Mantiene un mapa `details[name]` con el payload de `artist-detail`. La
 * primera carga llama a la Edge Function (que combina Last.fm + Innertube
 * y cachea 24h server-side). Recargas posteriores con el mismo nombre
 * reusan la entrada en memoria sin tocar red.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';
import { api, isDesktop } from '../lib/api.js';
import { pushTrack } from '../lib/sync.js';
import { tryOrQueue } from '../lib/sync-queue.js';
import { usePlaylistsStore } from './playlists.js';
import { useLibraryStore } from './library.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callEdge(path, params) {
  if (!SUPABASE_URL) throw new Error('Supabase URL no configurado');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON;
  const url = new URL(`${SUPABASE_URL}/functions/v1/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON ?? '',
    },
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error ?? `${path} ${r.status}`);
  }
  return r.json();
}

const callArtistDetail = (name) => callEdge('artist-detail', { name });
const callAlbumResolve = (artist, album) => callEdge('album-resolve', { artist, album });

export const useArtistStore = create((set, get) => ({
  /** @type {Record<string, any>} */
  details: {},
  /** @type {Record<string, any>} */
  albums: {},          // key = `${artist}::${album}` (lowercase)
  /** @type {Record<string, { saving:boolean, error:string|null, progress:number }>} */
  saves: {},
  /**
   * Estado de "guardar discografia completa" por artista.
   * key = artistName (mismo casing que useArtistStore.details).
   * @type {Record<string, { saving:boolean, done:number, total:number, failed:string[], error:string|null }>}
   */
  discographySaves: {},

  /** @param {string} name */
  async fetch(name) {
    const key = String(name ?? '').trim();
    if (!key) return null;
    const cur = get().details[key];
    if (cur?.name) return cur;
    if (cur?.loading) return cur;
    set((s) => ({ details: { ...s.details, [key]: { loading: true, error: null } } }));
    try {
      const payload = await callArtistDetail(key);
      set((s) => ({ details: { ...s.details, [key]: { ...payload, loading: false } } }));
      return payload;
    } catch (err) {
      console.warn('[artist] fetch failed', err?.message);
      const entry = { loading: false, error: String(err?.message ?? err) };
      set((s) => ({ details: { ...s.details, [key]: entry } }));
      return entry;
    }
  },

  /**
   * Resuelve un álbum a tracks reproducibles (con ytId). Cache en memoria
   * + cache server-side de 7 días.
   * @param {string} artist
   * @param {string} album
   */
  async resolveAlbum(artist, album) {
    const key = `${artist.toLowerCase()}::${album.toLowerCase()}`;
    const cur = get().albums[key];
    if (cur?.tracks?.length) return cur;
    if (cur?.loading) return cur;
    set((s) => ({ albums: { ...s.albums, [key]: { loading: true, error: null } } }));
    try {
      const payload = await callAlbumResolve(artist, album);
      const entry = { ...payload, loading: false };
      set((s) => ({ albums: { ...s.albums, [key]: entry } }));
      return entry;
    } catch (err) {
      console.warn('[album] resolve failed', artist, album, err?.message);
      const entry = { loading: false, error: String(err?.message ?? err), tracks: [] };
      set((s) => ({ albums: { ...s.albums, [key]: entry } }));
      return entry;
    }
  },

  /**
   * Persiste un álbum como playlist en la biblioteca del usuario.
   *  1. Crea playlist `<Artista> - <Álbum>`.
   *  2. Para cada track: `libraryAddFromMeta` (dedup por yt_id).
   *  3. Añade en orden a la playlist.
   *  4. Setea cover del álbum como cover de la playlist.
   * Devuelve el id de la playlist creada para que el llamador navegue.
   * @param {{artist:string, album:string, coverUrl?:string|null, tracks:any[]}} input
   */
  async saveAlbumAsPlaylist({ artist, album, coverUrl, tracks }) {
    const key = `${artist.toLowerCase()}::${album.toLowerCase()}`;
    if (!tracks || tracks.length === 0) return null;
    set((s) => ({ saves: { ...s.saves, [key]: { saving: true, error: null, progress: 0 } } }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('sin sesión');

      // 1. Crear playlist.
      const playlist = await usePlaylistsStore.getState().create(`${artist} – ${album}`);

      // 2 + 3. Persistir tracks en serie y añadirlos a la playlist.
      // (Serie evita conflictos de unicidad en (user_id, yt_id) cuando el
      //  álbum tiene tracks duplicados o si yt-dlp devuelve mismo ytId
      //  para distintos títulos.)
      // Filtrar tracks sin ytId (album-resolve puede devolver nulls si
      // ytSearchFirst no encontró match para algún track oscuro de Last.fm).
      const validTracks = (tracks ?? []).filter((t) => t?.ytId);
      const total = validTracks.length;
      if (total === 0) {
        set((s) => ({ saves: { ...s.saves, [key]: { saving: false, error: 'Ningún track del álbum tiene ID de YouTube válido', progress: 0 } } }));
        return null;
      }

      let done = 0;
      let failed = 0;
      for (const t of validTracks) {
        try {
          const persisted = await api.libraryAddFromMeta({
            meta: {
              id: t.ytId,
              title: t.title,
              artist: artist,
              album: album,
              duration: t.duration ?? null,
              thumbnail: t.thumbnail ?? coverUrl ?? null,
              uploader: artist,
            },
            userId,
          });

          // En desktop, libraryAddFromMeta solo escribe a SQLite local.
          // DEBEMOS sincronizar el track a Supabase ANTES de llamar a
          // playlists.addTrack — si no, el INSERT en playlist_tracks falla
          // con FK violation 23503 (playlist_tracks.track_id → tracks.id).
          //
          // Mismo patrón que library.persistEphemeral (library.js:129-131).
          // En PWA esto es no-op porque persistFromMeta ya escribió a Supabase.
          if (isDesktop) {
            await tryOrQueue(
              () => pushTrack(persisted),
              { kind: 'track.upsert', payload: persisted }
            );
          }

          await usePlaylistsStore.getState().addTrack(playlist.id, persisted.id);
        } catch (e) {
          failed++;
          console.warn('[album] persist track failed', t?.title, e?.message);
        }
        done++;
        set((s) => ({
          saves: { ...s.saves, [key]: { saving: true, error: null, progress: Math.round((done / total) * 100) } },
        }));
      }

      // Si TODOS los tracks fallaron, no navegamos a una playlist vacía.
      if (failed === total) {
        set((s) => ({
          saves: { ...s.saves, [key]: { saving: false, error: `No se pudo añadir ningún track (${failed}/${total} fallaron)`, progress: 100 } },
        }));
        return null;
      }

      // 4. Cover de la playlist (best-effort).
      if (coverUrl) {
        try { await usePlaylistsStore.getState().setCover(playlist.id, coverUrl); } catch {}
      }

      // 5. Refrescar biblioteca para que aparezcan los nuevos tracks.
      try { await useLibraryStore.getState().load(); } catch {}

      set((s) => ({ saves: { ...s.saves, [key]: { saving: false, error: null, progress: 100 } } }));
      return playlist.id;
    } catch (err) {
      console.warn('[album] save failed', err?.message);
      set((s) => ({
        saves: { ...s.saves, [key]: { saving: false, error: String(err?.message ?? err), progress: 0 } },
      }));
      return null;
    }
  },

  /**
   * Guarda la discografia completa del artista como N playlists (una por
   * album). Itera albumes en serie para no saturar Last.fm/Innertube ni
   * Supabase. Si un album falla, continua con el resto y reporta al final.
   *
   * Reusa resolveAlbum + saveAlbumAsPlaylist que ya cachean en memoria,
   * asi que llamar a este metodo tras navegar manualmente por algunos
   * albumes evita re-resolverlos.
   *
   * @param {string} name nombre del artista (debe estar en details).
   * @returns {Promise<{ done:number, total:number, failed:string[], playlistIds:string[] }>}
   */
  async saveDiscography(name) {
    const key = String(name ?? '').trim();
    if (!key) return { done: 0, total: 0, failed: [], playlistIds: [] };

    const details = get().details[key];
    const albums = details?.albums ?? [];
    if (albums.length === 0) {
      return { done: 0, total: 0, failed: [], playlistIds: [] };
    }

    // Evitar doble-click: si ya esta corriendo, devuelve el estado actual.
    const existing = get().discographySaves[key];
    if (existing?.saving) {
      return { done: existing.done, total: existing.total, failed: existing.failed, playlistIds: [] };
    }

    set((s) => ({
      discographySaves: {
        ...s.discographySaves,
        [key]: { saving: true, done: 0, total: albums.length, failed: [], error: null },
      },
    }));

    const failed = [];
    const playlistIds = [];
    let done = 0;

    for (const al of albums) {
      try {
        // 1. Resolver el album a tracks reproducibles (puede venir de cache
        //    en memoria si el user ya lo abrio antes).
        const resolved = await get().resolveAlbum(key, al.title);
        if (!resolved?.tracks || resolved.tracks.length === 0) {
          failed.push(al.title);
        } else {
          // 2. Persistir como playlist. saveAlbumAsPlaylist devuelve playlist.id
          //    o null si fallo.
          const plId = await get().saveAlbumAsPlaylist({
            artist: key,
            album: al.title,
            coverUrl: al.coverUrl ?? resolved.coverUrl ?? null,
            tracks: resolved.tracks,
          });
          if (plId) playlistIds.push(plId);
          else failed.push(al.title);
        }
      } catch (err) {
        console.warn('[discography] album save failed', al?.title, err?.message);
        failed.push(al.title);
      }
      done++;
      set((s) => ({
        discographySaves: {
          ...s.discographySaves,
          [key]: { saving: true, done, total: albums.length, failed: [...failed], error: null },
        },
      }));
    }

    set((s) => ({
      discographySaves: {
        ...s.discographySaves,
        [key]: { saving: false, done, total: albums.length, failed: [...failed], error: null },
      },
    }));

    return { done, total: albums.length, failed, playlistIds };
  },

  reset() { set({ details: {}, albums: {}, saves: {}, discographySaves: {} }); },
}));
