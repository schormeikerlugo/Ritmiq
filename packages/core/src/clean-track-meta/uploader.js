/**
 * @module @ritmiq/core/clean-track-meta/uploader
 *
 * Limpia el nombre del uploader (channel name de YouTube) para
 * convertirlo en un artista presentable.
 *
 * Casos cubiertos:
 *   "Bad Bunny - Topic"  → "Bad Bunny"      // YT Music auto-generado
 *   "LinkinParkVEVO"     → "LinkinPark"     // VEVO sin separador
 *   "Dua Lipa VEVO"      → "Dua Lipa"       // VEVO con separador
 *   "Kanye West Official"→ "Kanye West"
 *   "Oficial Shakira"    → "Shakira"        // prefijo español
 *   "Kevin Kaarl"        → "Kevin Kaarl"    // sin cambios
 *
 * NO toca sellos discograficos puros (Sony Music, WMG): los devuelve
 * tal cual; el cleanYoutubeTitle los detecta como genericos via
 * GENERIC_UPLOADER_RE y decide split sobre el titulo.
 *
 * Idempotente: cleanUploader(cleanUploader(x)) === cleanUploader(x).
 */

import {
  UPLOADER_TOPIC_SUFFIX,
  UPLOADER_SUFFIX_GLUED,
  UPLOADER_SUFFIX_SEP,
  UPLOADER_PREFIX,
  GENERIC_UPLOADER_RE,
  UPLOADER_IS_CHANNEL_RE,
  MULTI_SPACE,
} from './patterns.js';

/**
 * @param {string|null|undefined} raw
 * @returns {string|null}  Nombre limpio del uploader, o null si input vacio.
 */
export function cleanUploader(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // 1. Caso especial Topic: senial muy fuerte de cancion oficial.
  //    "Bad Bunny - Topic" → "Bad Bunny" (auto-generado por YT Music
  //    para representar al artista canonico de una pista oficial).
  if (UPLOADER_TOPIC_SUFFIX.test(s)) {
    return s.replace(UPLOADER_TOPIC_SUFFIX, '').trim();
  }

  // 2. Sufijo pegado tipo "ArtistVEVO" / "ArtistTV".
  //    Aplica solo si la letra previa es minuscula (evita cortar
  //    nombres legitimos en mayusculas).
  s = s.replace(UPLOADER_SUFFIX_GLUED, '');

  // 3. Sufijo con separador "Artist VEVO" / "Artist Music".
  s = s.replace(UPLOADER_SUFFIX_SEP, '');

  // 4. Prefijo "Official " / "Oficial ".
  s = s.replace(UPLOADER_PREFIX, '');

  // 5. Whitespace normalize.
  s = s.replace(MULTI_SPACE, ' ').trim();

  // Fallback: si quedo vacio (caso raro), devolver el original limpio.
  return s || String(raw).trim();
}

/**
 * Heuristica: ¿este uploader es generico/sello discografico, de modo
 * que el titulo PROBABLEMENTE incluya al artista real en formato
 * "Artista - Titulo"?
 *
 * @param {string|null|undefined} rawOrCleanUploader
 * @returns {boolean}
 */
export function isGenericUploader(rawOrCleanUploader) {
  if (!rawOrCleanUploader) return true; // sin uploader = asumimos generico
  const s = String(rawOrCleanUploader);
  return GENERIC_UPLOADER_RE.test(s) || UPLOADER_IS_CHANNEL_RE.test(s);
}
