/**
 * @module @ritmiq/core/clean-track-meta/normalize
 *
 * Normalizacion ligera para metadata que YA viene estructurada de una
 * fuente confiable (Spotify import, Last.fm via album-resolve, etc).
 *
 * NO intenta inferir artist del title — confia en lo que viene.
 * Solo aplica:
 *   - Trim + colapso de whitespace.
 *   - Strip de markers Tier 1 obvios del title (Official Video, HD, ...)
 *     por si la fuente externa los incluyo.
 *   - Limites de longitud para seguridad de BD.
 */

import {
  PARENS_MARKERS,
  TRAILING_MARKERS,
  DECORATIVE_EDGES,
  MULTI_SPACE,
  EMPTY_BRACKETS,
} from './patterns.js';

const MAX_TITLE = 500;
const MAX_ARTIST = 500;
const MAX_ALBUM = 500;

/**
 * @param {string|null|undefined} s
 * @param {number} max
 * @returns {string|null}
 */
function tidyString(s, max) {
  if (!s) return null;
  let out = String(s).trim();
  if (!out) return null;
  out = out.replace(MULTI_SPACE, ' ');
  if (out.length > max) out = out.slice(0, max);
  return out;
}

/**
 * Limpia un title que YA viene parseado (no de YouTube directo) — solo
 * remueve markers obvios y normaliza whitespace.
 *
 * @param {string|null|undefined} s
 * @returns {string|null}
 */
function tidyTitle(s) {
  if (!s) return null;
  let out = String(s);
  let prev;
  do {
    prev = out;
    out = out.replace(PARENS_MARKERS, ' ');
  } while (out !== prev);
  do {
    prev = out;
    out = out.replace(TRAILING_MARKERS, '');
  } while (out !== prev);
  out = out.replace(DECORATIVE_EDGES, '');
  out = out.replace(EMPTY_BRACKETS, ' ');
  return tidyString(out, MAX_TITLE);
}

/**
 * Normaliza meta de fuente estructurada (Spotify/Last.fm).
 *
 * @param {object} input
 * @param {string|null} [input.title]
 * @param {string|null} [input.artist]
 * @param {string|null} [input.album]
 * @returns {{title: string|null, artist: string|null, album: string|null}}
 */
export function normalizeMeta({ title = null, artist = null, album = null } = {}) {
  return {
    title: tidyTitle(title),
    artist: tidyString(artist, MAX_ARTIST),
    album: tidyString(album, MAX_ALBUM),
  };
}
