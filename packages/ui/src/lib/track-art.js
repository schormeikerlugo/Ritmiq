/**
 * Portada "buena" de una canción y foto del artista (ver stores/art.js).
 *
 * Reglas:
 *   - Portada puesta a mano (coverUrl que NO es miniatura de YouTube, p. ej.
 *     elegida con "Buscar portada" o importada de Spotify) → siempre esa.
 *   - Si el servidor identificó la canción → portada oficial. En la TV, en
 *     casa, servida por el propio servidor (~10 ms); si no, CDN de Apple/Deezer.
 *   - Si no → la miniatura de YouTube de siempre.
 *
 * @module @ritmiq/ui/lib/track-art
 */
import { useEffect } from 'react';
import { useArtStore } from '../stores/art.js';
import { getServerLanUrlSync } from './lan-client.js';

const YT_THUMB = /(^https?:\/\/)?([a-z0-9-]+\.)?(ytimg\.com|ggpht\.com|googleusercontent\.com)\//i;

/** ¿Es una miniatura automática de YouTube (sustituible)? */
export function isYouTubeThumb(url) {
  return !url || YT_THUMB.test(url);
}

function lanArt(kind, ytId, size) {
  const lan = getServerLanUrlSync();
  return lan ? `${lan}/art/${kind}/${ytId}${kind === 'track' && size <= 300 ? '?s=300' : ''}` : null;
}

/**
 * URL de portada para mostrar (sin hooks: para usos puntuales).
 * @param {{ ytId?: string|null, coverUrl?: string|null }} track
 * @param {300|1000} [size]
 */
export function coverOf(track, size = 300) {
  if (!track) return null;
  if (!isYouTubeThumb(track.coverUrl)) return track.coverUrl;
  const e = track.ytId ? useArtStore.getState().entries[track.ytId] : null;
  if (e?.s === 'found') return lanArt('track', track.ytId, size) ?? (size <= 300 ? e.cs : e.c) ?? track.coverUrl;
  return track.coverUrl ?? null;
}

/**
 * Hook: portada a mostrar; pide la identificación si aún no se conoce.
 * @param {object|null|undefined} track
 * @param {300|1000} [size]
 * @param {{ priority?: boolean }} [opts]  priority: la que suena
 */
export function useTrackCover(track, size = 300, opts = {}) {
  const ytId = track?.ytId ?? null;
  const custom = track && !isYouTubeThumb(track.coverUrl);
  const entry = useArtStore((s) => (ytId && !custom ? s.entries[ytId] : undefined));
  const want = useArtStore((s) => s.want);
  useEffect(() => {
    if (ytId && !custom && !entry) want(track, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytId, custom, entry]);
  if (!track) return null;
  if (custom) return track.coverUrl;
  if (entry?.s === 'found') return lanArt('track', ytId, size) ?? (size <= 300 ? entry.cs : entry.c) ?? track.coverUrl;
  return track.coverUrl ?? null;
}

/**
 * Hook: foto grande del artista de la canción (o null).
 * @param {object|null|undefined} track
 */
export function useArtistImage(track) {
  const ytId = track?.ytId ?? null;
  const entry = useArtStore((s) => (ytId ? s.entries[ytId] : undefined));
  const want = useArtStore((s) => s.want);
  useEffect(() => {
    if (ytId && !entry) want(track, { priority: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytId, entry]);
  if (!entry?.a) return null;
  return lanArt('artist', ytId, 1000) ?? entry.a;
}
