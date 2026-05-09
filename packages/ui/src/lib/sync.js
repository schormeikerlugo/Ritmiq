/**
 * Sync entre Supabase y la biblioteca local.
 *
 * Estrategia:
 * - Pull: al iniciar sesión, descargar todos los tracks/playlists del usuario.
 * - Push: cada mutación local (añadir, descargar) se envía a Supabase.
 *   En desktop además se persiste en SQLite via IPC.
 *
 * Política de conflictos: last-write-wins por updated_at del servidor (autoritativo
 * cuando hay red).
 */

import { supabase } from './supabase.js';
import { rewriteHost } from './url-rewrite.js';

/**
 * @typedef {import('@ritmiq/core/types').Track} Track
 * @typedef {import('@ritmiq/core/types').Playlist} Playlist
 */

/* ── tracks ─────────────────────────────────────────────────────────── */

/** @param {any} row */
function rowToTrack(row) {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    ytId: row.yt_id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    durationSeconds: row.duration_seconds,
    coverUrl: rewriteHost(row.cover_url),
    filePath: row.file_path,
    isDownloaded: !!row.is_downloaded,
    createdAt: row.created_at,
  };
}

/** @param {Track} t */
function trackToRow(t) {
  return {
    id: t.id,
    user_id: t.userId,
    source: t.source,
    yt_id: t.ytId,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration_seconds: t.durationSeconds,
    cover_url: t.coverUrl,
    is_downloaded: false, // file_path/is_downloaded son por-dispositivo
  };
}

/** @returns {Promise<Track[]>} */
export async function pullTracks() {
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToTrack);
}

/** @param {Track} track */
export async function pushTrack(track) {
  const { error } = await supabase
    .from('tracks')
    .upsert(trackToRow(track), { onConflict: 'id' });
  if (error) throw error;
}

/** @param {string} trackId */
export async function deleteTrackRemote(trackId) {
  const { error } = await supabase.from('tracks').delete().eq('id', trackId);
  if (error) throw error;
}

/* ── playlists ──────────────────────────────────────────────────────── */

/** @param {any} row */
function rowToPlaylist(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    isOffline: !!row.is_offline,
    coverUrl: rewriteHost(row.cover_url) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** @param {Playlist} p */
function playlistToRow(p) {
  return {
    id: p.id,
    user_id: p.userId,
    name: p.name,
    is_offline: p.isOffline,
    cover_url: p.coverUrl ?? null,
  };
}

/** @returns {Promise<Playlist[]>} */
export async function pullPlaylists() {
  const { data, error } = await supabase
    .from('playlists')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToPlaylist);
}

/** @param {Playlist} p */
export async function pushPlaylist(p) {
  const { error } = await supabase
    .from('playlists')
    .upsert(playlistToRow(p), { onConflict: 'id' });
  if (error) throw error;
}

/** @param {string} playlistId */
export async function deletePlaylistRemote(playlistId) {
  const { error } = await supabase.from('playlists').delete().eq('id', playlistId);
  if (error) throw error;
}

/** @returns {Promise<Record<string,string[]>>} */
export async function pullPlaylistContents() {
  const { data, error } = await supabase
    .from('playlist_tracks')
    .select('playlist_id, track_id, position')
    .order('position', { ascending: true });
  if (error) throw error;
  /** @type {Record<string,string[]>} */
  const out = {};
  for (const r of (data ?? [])) {
    if (!out[r.playlist_id]) out[r.playlist_id] = [];
    out[r.playlist_id].push(r.track_id);
  }
  return out;
}

/** @param {string} playlistId @param {string} trackId @param {number} position */
export async function pushPlaylistTrack(playlistId, trackId, position) {
  const { error } = await supabase
    .from('playlist_tracks')
    .upsert(
      { playlist_id: playlistId, track_id: trackId, position },
      { onConflict: 'playlist_id,track_id' }
    );
  if (error) throw error;
}

/** @param {string} playlistId @param {string} trackId */
export async function removePlaylistTrackRemote(playlistId, trackId) {
  const { error } = await supabase
    .from('playlist_tracks')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('track_id', trackId);
  if (error) throw error;
}

/**
 * Reordena las pistas de una playlist actualizando `position` en una sola
 * petición upsert.
 * @param {string} playlistId
 * @param {string[]} orderedTrackIds
 */
export async function reorderPlaylistRemote(playlistId, orderedTrackIds) {
  const rows = orderedTrackIds.map((trackId, position) => ({
    playlist_id: playlistId,
    track_id: trackId,
    position,
  }));
  const { error } = await supabase
    .from('playlist_tracks')
    .upsert(rows, { onConflict: 'playlist_id,track_id' });
  if (error) throw error;
}
