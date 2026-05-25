/**
 * API client agnóstico de plataforma para la UI.
 * - En Electron: usa el bridge `window.ritmiq` (IPC).
 * - En PWA: habla con el LAN server del Electron (si está configurado) y
 *   con Supabase para persistencia.
 */

import { supabase } from './supabase.js';
import { lanSearch, lanMetadata, getLanBaseUrlSync, getTunnelUrlSync } from './lan-client.js';
import { randomId } from './id.js';
import { rewriteHost } from './url-rewrite.js';
import { cleanYoutubeTitle, cleanUploader } from '@ritmiq/core';
import {
  downloadTrackToLocal, removeLocal, getLocalSize,
} from './local-downloads.js';

const isElectron = typeof window !== 'undefined' && Boolean(window.ritmiq);

// Pubsub de progreso para descargas PWA (replica el contrato del IPC desktop).
/** @type {Set<(payload:{trackId:string,pct:number})=>void>} */
const pwaProgressListeners = new Set();
function pwaEmitProgress(trackId, pct) {
  for (const cb of pwaProgressListeners) {
    try { cb({ trackId, pct }); } catch {}
  }
}

// Helper que llama a un método del bridge si existe; si no, no-op.
// Útil mientras se evolucionan los IPC sin romper si el preload está desfasado.
const optionalCall = (fn, fallback = async () => null) =>
  (typeof fn === 'function' ? fn : fallback);

const electronApi = isElectron
  ? {
      appInfo:                 () => window.ritmiq.appInfo(),
      ytMetadata:              (q) => window.ritmiq.yt.metadata(q),
      ytStreamUrl:             (q) => window.ritmiq.yt.streamUrl(q),
      ytSearch:                (q) => window.ritmiq.yt.search(q),
      // Multi-tipo y por-tipo: pegamos directo a la Edge Function ya que el
      // yt-dlp embebido del desktop solo retorna videos.
      ytSearchAll:             (q) => edgeSearchAll(q),
      ytSearchByType:          (q, type, max = 20) => edgeSearchByType(q, type, max),
      ytdlpInfo:               () => window.ritmiq.ytdlp.info(),
      ytdlpUpdate:             () => window.ritmiq.ytdlp.update(),
      sharedCacheStats:        () => window.ritmiq.sharedCache.stats(),
      sharedCacheClear:        () => window.ritmiq.sharedCache.clear(),

      tunnelStatus:            () => window.ritmiq.tunnel.status(),
      tunnelSetToken:          (t) => window.ritmiq.tunnel.setToken(t),
      tunnelSetCustomUrl:      (u) => window.ritmiq.tunnel.setCustomUrl(u),
      tunnelStart:             (opts) => window.ritmiq.tunnel.start(opts),
      tunnelStartQuick:        () => window.ritmiq.tunnel.startQuick(),
      tunnelStop:              () => window.ritmiq.tunnel.stop(),
      tunnelOnState:           (cb) => window.ritmiq.tunnel.onState(cb),

      authToken:               () => window.ritmiq.auth.token(),
      authRegenerateToken:     () => window.ritmiq.auth.regenerateToken(),

      libraryList:             (uid) => window.ritmiq.library.list(uid),
      libraryAdd:              (p) => window.ritmiq.library.addFromYoutube(p),
      libraryAddFromMeta:      (p) => window.ritmiq.library.addFromMetadata(p),
      libraryDownload:         (idOrPayload) => window.ritmiq.library.download(idOrPayload),
      libraryUndownload:       (id) => window.ritmiq.library.undownload(id),
      libraryFileSize:         (id) => window.ritmiq.library.fileSize(id),
      librarySyncRemote:       optionalCall(window.ritmiq.library.syncRemote),
      libraryDeleteRemote:     optionalCall(window.ritmiq.library.deleteRemote),
      libraryUpdate:           optionalCall(window.ritmiq.library.update),
      libraryOnDownloadProgress: (cb) => window.ritmiq.library.onDownloadProgress(cb),

      devicesList:             () => window.ritmiq.devices.list(),
      devicesPending:          () => window.ritmiq.devices.pending(),
      devicesApprove:          (id) => window.ritmiq.devices.approve(id),
      devicesReject:           (id) => window.ritmiq.devices.reject(id),
      devicesRevoke:           (id) => window.ritmiq.devices.revoke(id),
      devicesForget:           (id) => window.ritmiq.devices.forget(id),
      devicesRename:           (id, name) => window.ritmiq.devices.rename(id, name),
      devicesActivity:         (id, limit) => window.ritmiq.devices.activity(id, limit),
      devicesOnPairRequest:    (cb) => window.ritmiq.devices.onPairRequest(cb),

      playlistsList:           (uid) => window.ritmiq.playlists.list(uid),
      playlistsUpsert:         (p) => window.ritmiq.playlists.upsert(p),
      playlistsDelete:         (id) => window.ritmiq.playlists.delete(id),
      playlistsTracks:         (id) => window.ritmiq.playlists.tracks(id),
      playlistsAddTrack:       (p) => window.ritmiq.playlists.addTrack(p),
      playlistsRemoveTrack:    (p) => window.ritmiq.playlists.removeTrack(p),
      playlistsReorder:        (p) => window.ritmiq.playlists.reorder(p),
      playlistsContents:       (uid) => window.ritmiq.playlists.contents(uid),
    }
  : null;

// ── Implementación PWA: combina LAN (descubrimiento de YouTube) + Supabase
//    (persistencia). No hay yt-dlp en el navegador.
const webApi = {
  appInfo: async () => ({ lanPort: null, audioDir: null }),

  ytSearch: async (q) => {
    // 1) Si hay LAN o Tunnel configurado, usar el lan-server del PC. Esto
    //    es CRÍTICO en PWA móvil: el server hace prewarm de yt-dlp para los
    //    3 primeros resultados, así el play() empieza al instante. Si solo
    //    miramos LAN local, el móvil fuera de casa cae a Edge sin prewarm
    //    y la primera reproducción tarda 5-10s extra.
    if (getLanBaseUrlSync() || getTunnelUrlSync()) {
      try { return await lanSearch(q); } catch (err) {
        console.warn('[api.ytSearch] LAN/Tunnel falló, intentando Edge Function', err);
      }
    }
    // 2) Fallback a Edge Function search-youtube.
    return edgeSearch(q);
  },

  ytSearchAll: (q) => edgeSearchAll(q),
  ytSearchByType: (q, type, max = 20) => edgeSearchByType(q, type, max),

  ytMetadata: async (q) => {
    if (getLanBaseUrlSync() || getTunnelUrlSync()) {
      try { return await lanMetadata(q); } catch (err) {
        console.warn('[api.ytMetadata] LAN/Tunnel falló, intentando Edge Function', err);
      }
    }
    // Fallback: usar el primer resultado de search como metadata aproximada.
    // (Edge Function no tiene endpoint /metadata; con search es suficiente
    // porque ya trae title/uploader/duration/thumbnail.)
    const ytId = extractYtId(q);
    if (ytId) {
      const items = await edgeSearch(ytId);
      const hit = items.find((it) => it.id === ytId) ?? items[0];
      if (hit) return hit;
    }
    throw new Error('No se pudo resolver metadata sin LAN');
  },

  ytStreamUrl: async () => {
    throw new Error('PWA: stream URL se obtiene vía LAN /stream/:id');
  },

  ytdlpInfo: async () => ({ path: null, version: null }),
  ytdlpUpdate: async () => { throw new Error('Solo desktop'); },
  sharedCacheStats: async () => ({ count: 0, totalBytes: 0 }),
  sharedCacheClear: async () => ({ removed: 0, freedBytes: 0 }),

  tunnelStatus: async () => ({ status: 'idle', url: null, error: null, hasToken: false, customUrl: null }),
  tunnelSetToken: async () => { throw new Error('Solo desktop'); },
  tunnelSetCustomUrl: async () => { throw new Error('Solo desktop'); },
  tunnelStart: async () => { throw new Error('Solo desktop'); },
  tunnelStartQuick: async () => { throw new Error('Solo desktop'); },
  tunnelStop: async () => { throw new Error('Solo desktop'); },
  tunnelOnState: () => () => {},

  authToken: async () => null,
  authRegenerateToken: async () => null,

  // Lista la biblioteca: en PWA consultamos Supabase directamente.
  libraryList: async () => {
    const { data, error } = await supabase
      .from('tracks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToTrack);
  },

  libraryAdd: async ({ idOrUrl, userId }) => {
    const meta = await webApi.ytMetadata(idOrUrl);
    return persistFromMeta(meta, userId);
  },

  libraryAddFromMeta: async ({ meta, userId }) => persistFromMeta(meta, userId),

  // PWA: descarga a IndexedDB con progreso emitido al pubsub local.
  libraryDownload: async (trackId) => {
    const { useLibraryStore } = await import('../stores/library.js');
    const t = useLibraryStore.getState().tracks.find((x) => x.id === trackId);
    await downloadTrackToLocal(trackId, (pct) => pwaEmitProgress(trackId, pct), {
      ytId: t?.ytId,
    });
    return true;
  },
  libraryUndownload: async (trackId) => {
    await removeLocal(trackId);
    return true;
  },
  libraryFileSize: async (trackId) => getLocalSize(trackId),
  librarySyncRemote: async () => true,    // no-op en PWA: no hay SQLite local
  libraryDeleteRemote: async () => true,
  libraryUpdate: async () => true,        // no-op en PWA: el UPDATE va directo a Supabase via pushTrack
  libraryOnDownloadProgress: (cb) => {
    pwaProgressListeners.add(cb);
    return () => pwaProgressListeners.delete(cb);
  },

  // En PWA, los handlers de devices solo aplican al lado desktop.
  devicesList: async () => [],
  devicesPending: async () => [],
  devicesApprove: async () => { throw new Error('Solo desktop'); },
  devicesReject: async () => { throw new Error('Solo desktop'); },
  devicesRevoke: async () => { throw new Error('Solo desktop'); },
  devicesForget: async () => { throw new Error('Solo desktop'); },
  devicesRename: async () => { throw new Error('Solo desktop'); },
  devicesActivity: async () => [],
  devicesOnPairRequest: () => () => {},

  // Las playlists viven 100% en Supabase para PWA (no hay SQLite local).
  // Los stores ya leen/escriben directamente vía supabase-js,
  // estos endpoints sólo se llaman en desktop.
  playlistsList: async () => [],
  playlistsUpsert: async (p) => p,
  playlistsDelete: async () => true,
  playlistsTracks: async () => [],
  playlistsAddTrack: async () => true,
  playlistsRemoveTrack: async () => true,
  playlistsReorder: async () => true,
  playlistsContents: async () => ({}),
};

/**
 * Construye los headers de autenticación para llamar a una Edge Function.
 * Usa el access_token del usuario logueado (real JWT) en `Authorization` y
 * la `anon publishable key` en `apikey`. Con las keys nuevas
 * (`sb_publishable_*`) NO podemos usar la anon key como Bearer porque la
 * gateway la valida como JWT y rechaza el formato — falla con 401.
 */
async function edgeAuthHeaders() {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? anonKey;
  return {
    Authorization: `Bearer ${token}`,
    apikey: anonKey,
  };
}

/**
 * Llama a la Edge Function `search-youtube` (Supabase Cloud) y normaliza
 * la respuesta al mismo shape que devuelve el LAN server.
 *
 * @param {string} q
 * @returns {Promise<Array<{id:string,title:string,uploader:string|null,duration:number|null,thumbnail:string|null}>>}
 */
async function edgeSearch(q) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error('Sin Supabase configurado');
  const url = `${base}/functions/v1/search-youtube?q=${encodeURIComponent(q)}&max=12`;
  const r = await fetch(url, { headers: await edgeAuthHeaders() });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error ?? `Edge search ${r.status}`);
  }
  const j = await r.json();
  return j.items ?? [];
}

/**
 * Búsqueda multi-tipo: { videos, channels, playlists } — 5 de cada.
 * @param {string} q
 */
async function edgeSearchAll(q) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error('Sin Supabase configurado');
  const url = `${base}/functions/v1/search-youtube?q=${encodeURIComponent(q)}&type=all`;
  const r = await fetch(url, { headers: await edgeAuthHeaders() });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error ?? `Edge search ${r.status}`);
  }
  return r.json();
}

/**
 * Búsqueda paginada por tipo específico.
 * @param {string} q
 * @param {'videos'|'channels'|'playlists'} type
 * @param {number} [max=20]
 */
async function edgeSearchByType(q, type, max = 20) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error('Sin Supabase configurado');
  const url = `${base}/functions/v1/search-youtube?q=${encodeURIComponent(q)}&type=${type}&max=${max}`;
  const r = await fetch(url, { headers: await edgeAuthHeaders() });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error ?? `Edge search ${r.status}`);
  }
  return r.json();
}

/**
 * Extrae un ID de YouTube de una URL completa, una URL corta o un ID pelado.
 * @param {string} input
 * @returns {string|null}
 */
function extractYtId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([\w-]{11})/);
  return m?.[1] ?? null;
}

/**
 * Persiste un track desde metadata en Supabase. Devuelve el Track con
 * formato del cliente. Si ya existe (mismo yt_id), reusa la fila.
 *
 * `meta.album` y `meta.artist` (explícitos) tienen prioridad sobre
 * `meta.uploader` — útil cuando se importa desde Last.fm donde sabemos
 * el artista y el álbum reales, no solo el "canal" de YouTube.
 *
 * @param {{id:string,title:string,uploader?:string|null,artist?:string|null,album?:string|null,duration?:number|null,thumbnail?:string|null}} meta
 * @param {string} userId
 */
async function persistFromMeta(meta, userId) {
  // Buscar existente primero (path rápido para el caso común).
  const { data: existing } = await supabase
    .from('tracks')
    .select('*')
    .eq('user_id', userId)
    .eq('yt_id', meta.id)
    .maybeSingle();
  if (existing) {
    // Si el track ya existe pero le falta artista/álbum, los enriquecemos.
    const updates = {};
    if (!existing.artist && (meta.artist || meta.uploader)) updates.artist = meta.artist ?? meta.uploader;
    if (!existing.album && meta.album) updates.album = meta.album;
    if (Object.keys(updates).length > 0) {
      const { data } = await supabase
        .from('tracks')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();
      if (data) return rowToTrack(data);
    }
    return rowToTrack(existing);
  }

  // Limpieza canonica antes de persistir. Si meta.artist viene explicito
  // (fuente confiable: Spotify, Last.fm), respetamos ese valor por
  // encima de la heuristica. Ver packages/core/src/clean-track-meta/.
  const cleaned = cleanYoutubeTitle({
    rawTitle: meta.title,
    rawUploader: meta.uploader ?? meta.artist,
  });
  const finalTitle = cleaned.title || meta.title;
  const finalArtist = meta.artist ?? cleaned.artist ?? cleanUploader(meta.uploader) ?? meta.uploader ?? null;

  const row = {
    id: randomId(),
    user_id: userId,
    source: 'youtube',
    yt_id: meta.id,
    title: finalTitle,
    artist: finalArtist,
    album: meta.album ?? null,
    duration_seconds: meta.duration ?? null,
    cover_url: meta.thumbnail ?? null,
    is_downloaded: false,
  };
  const { data, error } = await supabase
    .from('tracks')
    .insert(row)
    .select()
    .single();
  if (error) {
    // Race condition: otro worker insertó el mismo (user_id, yt_id) entre
    // nuestro select y nuestro insert. Re-leemos y devolvemos esa fila.
    if (String(error.code) === '23505' || /duplicate|unique/i.test(error.message ?? '')) {
      const { data: again } = await supabase
        .from('tracks')
        .select('*')
        .eq('user_id', userId)
        .eq('yt_id', meta.id)
        .maybeSingle();
      if (again) return rowToTrack(again);
    }
    throw error;
  }
  return rowToTrack(data);
}

/** @param {any} r */
function rowToTrack(r) {
  return {
    id: r.id,
    userId: r.user_id,
    source: r.source,
    ytId: r.yt_id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    durationSeconds: r.duration_seconds,
    coverUrl: rewriteHost(r.cover_url),
    filePath: r.file_path ?? null,
    isDownloaded: !!r.is_downloaded,
    createdAt: r.created_at,
  };
}

export const api = electronApi ?? webApi;
export const isDesktop = isElectron;
