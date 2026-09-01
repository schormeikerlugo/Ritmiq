/**
 * pull-playlist — materializa un snapshot de playlist como una COPIA propia.
 *
 * Se usa en dos sitios:
 *   1. Inbox (playlist compartida por un amigo) — sin origen.
 *   2. Perfil de un amigo (jalar una playlist visible) — con origen
 *      (sourcePlaylistId + sourceOwnerId) para permitir re-sincronizar después.
 *
 * Flujo (respeta la FK playlist_tracks.track_id → tracks.id):
 *   a) Por cada track del snapshot → asegurar una fila en `tracks`
 *      (library.addFromMeta, idempotente por (user_id, yt_id)) y recolectar
 *      los UUID reales.
 *   b) Crear la playlist propia (con visibility + source_* si aplica).
 *   c) addTracks(playlistId, uuids).
 *
 * Snapshot track shape: { ytId, title, artist, coverUrl, durationSeconds }
 */

import { useLibraryStore } from '../stores/library.js';
import { usePlaylistsStore } from '../stores/playlists.js';
import { supabase } from './supabase.js';
import { toast } from '../stores/toast.js';

/**
 * @param {{
 *   name: string,
 *   tracks: Array<{ytId:string, title?:string, artist?:string, coverUrl?:string, durationSeconds?:number}>,
 *   sourcePlaylistId?: string|null,
 *   sourceOwnerId?: string|null,
 *   existingPlaylistId?: string|null,  // si se pasa, hace MERGE en vez de crear (re-sync)
 * }} opts
 * @returns {Promise<{ playlist: any, added: number } | null>}
 */
export async function pullPlaylistSnapshot(opts) {
  const { name, tracks, sourcePlaylistId = null, sourceOwnerId = null, existingPlaylistId = null } = opts;
  const snapshot = Array.isArray(tracks) ? tracks.filter((t) => t?.ytId) : [];
  if (snapshot.length === 0) {
    toast.show({ message: 'Esa playlist está vacía', icon: 'Info' });
    return null;
  }

  const library = useLibraryStore.getState();
  const playlists = usePlaylistsStore.getState();

  // a) Materializar cada track en la biblioteca (idempotente) → UUIDs reales.
  const uuids = [];
  for (const t of snapshot) {
    try {
      const persisted = await library.addFromMeta({
        id: t.ytId,
        title: t.title ?? 'Sin título',
        uploader: t.artist ?? null,
        duration: t.durationSeconds ?? null,
        thumbnail: t.coverUrl ?? null,
      });
      if (persisted?.id) uuids.push(persisted.id);
    } catch (e) {
      // Un track que falle no debe abortar toda la playlist.
      console.warn('[pull-playlist] track falló, se omite:', t.ytId, e?.message ?? e);
    }
  }

  if (uuids.length === 0) {
    toast.error('No se pudo guardar ninguna canción de la playlist');
    return null;
  }

  // b) Crear (o reutilizar) la playlist propia.
  let playlist;
  if (existingPlaylistId) {
    playlist = playlists.playlists.find((p) => p.id === existingPlaylistId) ?? null;
    if (!playlist) {
      // La copia local ya no existe: crear de nuevo.
      playlist = await usePlaylistsStore.getState().create(name, {
        sourcePlaylistId, sourceOwnerId, silent: true,
      });
    }
  } else {
    playlist = await usePlaylistsStore.getState().create(name, {
      sourcePlaylistId, sourceOwnerId, silent: true,
    });
  }

  // c) Añadir los tracks (addTracks dedup contra los ya presentes → merge OK).
  const before = (usePlaylistsStore.getState().contents[playlist.id] ?? []).length;
  await usePlaylistsStore.getState().addTracks(playlist.id, uuids);
  const after = (usePlaylistsStore.getState().contents[playlist.id] ?? []).length;
  const added = after - before;

  return { playlist, added };
}

/**
 * Notifica al dueño original que su playlist fue jalada (best-effort).
 * @param {{ ownerId:string, sourcePlaylistId:string, playlistName:string, coverUrl?:string|null, trackCount?:number }} args
 */
export async function notifyPlaylistPulled(args) {
  try {
    await supabase.functions.invoke('notify-playlist-pulled', { body: args });
  } catch (e) {
    // No es crítico: el jalado ya funcionó. Solo la notificación falló.
    console.warn('[pull-playlist] notify-owner falló (no crítico):', e?.message ?? e);
  }
}
