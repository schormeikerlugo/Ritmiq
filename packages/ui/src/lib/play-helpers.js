/**
 * Helpers para "reproducir desde cualquier sitio" — usado por los botones
 * flotantes de play en cards de Library/Sidebar/Home/Artist/Album.
 *
 * Centraliza la logica de:
 *   - resolver un playlistId → tracks
 *   - resolver (artist, album) → tracks via useArtistStore
 *   - resolver un artist → top tracks (todo lo que haya en lib del artista)
 *   - dispatch a usePlayerStore.playNow(tracks, 0)
 *
 * Todas las funciones devuelven Promise<boolean> — true si se inicio
 * reproduccion, false si no habia tracks resolvibles.
 *
 * @module @ritmiq/ui/lib/play-helpers
 */
import { usePlayerStore } from '../stores/player.js';
import { usePlaylistsStore } from '../stores/playlists.js';
import { useLibraryStore } from '../stores/library.js';

/**
 * Reproduce una playlist por id. Resuelve sus tracks desde el store de
 * playlists usando el patron canonico (contents[id] → mapear a library).
 *
 * @param {string} playlistId
 * @returns {boolean} true si arranco la reproduccion
 */
export function playPlaylist(playlistId) {
  const { contents } = usePlaylistsStore.getState();
  const { tracks: allTracks } = useLibraryStore.getState();
  const ids = contents[playlistId] ?? [];
  if (ids.length === 0) return false;
  const byId = new Map(allTracks.map((t) => [t.id, t]));
  const tracks = ids.map((id) => byId.get(id)).filter(Boolean);
  if (tracks.length === 0) return false;
  usePlayerStore.getState().playNow(tracks, 0);
  return true;
}

/**
 * Reproduce las tracks de un artista que estan en la biblioteca del user.
 * No hace fetch a internet — solo lo que ya tiene local. Para un "play
 * artist mas completo" usar la vista del artista (que ya lo hace).
 *
 * @param {string} artistName  case-insensitive
 * @returns {boolean}
 */
export function playArtistFromLibrary(artistName) {
  if (!artistName) return false;
  const { tracks: allTracks } = useLibraryStore.getState();
  const norm = artistName.toLowerCase().trim();
  const tracks = allTracks.filter((t) => (t.artist ?? '').toLowerCase().trim() === norm);
  if (tracks.length === 0) return false;
  usePlayerStore.getState().playNow(tracks, 0);
  return true;
}
