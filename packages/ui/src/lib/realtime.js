/**
 * Cliente Realtime: se suscribe a los cambios en las tablas del dominio
 * (tracks, playlists, playlist_tracks) filtrados por user_id, y entrega
 * eventos a los handlers del consumidor.
 *
 * Eventos: { eventType: 'INSERT'|'UPDATE'|'DELETE', new: row|null, old: row|null }
 */

import { supabase } from './supabase.js';

/** @typedef {{ eventType: 'INSERT'|'UPDATE'|'DELETE', new: any, old: any }} RealtimeEvent */

export class RealtimeManager {
  constructor() {
    /** @type {any[]} */
    this.channels = [];
    this.userId = null;
  }

  /**
   * @param {string} userId
   * @param {Object} handlers
   * @param {(e: RealtimeEvent) => void} handlers.onTracks
   * @param {(e: RealtimeEvent) => void} handlers.onPlaylists
   * @param {(e: RealtimeEvent) => void} handlers.onPlaylistTracks
   */
  start(userId, handlers) {
    if (this.userId === userId) return;
    this.stop();
    this.userId = userId;

    const tracksCh = supabase
      .channel(`rt-tracks-${userId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tracks', filter: `user_id=eq.${userId}` },
        (payload) => handlers.onTracks(toEvent(payload)))
      .subscribe();

    const playlistsCh = supabase
      .channel(`rt-playlists-${userId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'playlists', filter: `user_id=eq.${userId}` },
        (payload) => handlers.onPlaylists(toEvent(payload)))
      .subscribe();

    // playlist_tracks no tiene user_id directo. Suscribimos sin filtro y
    // RLS se encarga: solo recibimos filas de playlists nuestras.
    const playlistTracksCh = supabase
      .channel(`rt-playlist-tracks-${userId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'playlist_tracks' },
        (payload) => handlers.onPlaylistTracks(toEvent(payload)))
      .subscribe();

    this.channels = [tracksCh, playlistsCh, playlistTracksCh];
  }

  stop() {
    for (const ch of this.channels) {
      try { supabase.removeChannel(ch); } catch {}
    }
    this.channels = [];
    this.userId = null;
  }
}

/** @param {any} payload */
function toEvent(payload) {
  return {
    eventType: payload.eventType,
    new: payload.new ?? null,
    old: payload.old ?? null,
  };
}

export const realtime = new RealtimeManager();
