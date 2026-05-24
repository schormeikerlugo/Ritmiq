/**
 * @module @ritmiq/core/clean-track-meta/title
 *
 * Orquestador principal del cleaning de titulos crudos de YouTube.
 * Combina patrones de patterns.js + heuristica de uploader.js para
 * devolver { title, artist, confidence } presentable.
 *
 * FLUJO:
 *   1. Strip de markers Tier 1 (paréntesis con whitelist).
 *   2. Strip de TRAILING_MARKERS (suffix tras separador).
 *   3. Strip de DECORATIVE_EDGES (★ ♪ emojis en bordes).
 *   4. Normalizar feat./ft. variants a "(feat. X)".
 *   5. Whitespace + brackets vacios.
 *   6. Si uploader es generico (VEVO, Records, etc) Y el titulo tiene
 *      separador, SPLIT: izquierda → artist, derecha → title.
 *   7. cleanUploader(rawUploader) si no hubo split.
 *
 * IDEMPOTENCIA: clean(clean(x)) === clean(x) garantizado por whitelist
 * regex sin estado.
 *
 * CONFIDENCE:
 *   'high'   → uploader era "- Topic" (artista oficial canonico).
 *   'medium' → split por separador o cleanUploader exitoso.
 *   'low'    → no detecte artista confiable, devuelvo lo que pude.
 */

import {
  PARENS_MARKERS,
  TRAILING_MARKERS,
  DECORATIVE_EDGES,
  DASH_SEPARATOR,
  FEAT_BARE,
  FEAT_PARENS,
  MULTI_SPACE,
  EMPTY_BRACKETS,
  UPLOADER_TOPIC_SUFFIX,
} from './patterns.js';
import { cleanUploader, isGenericUploader } from './uploader.js';

/**
 * @typedef {object} CleanedTitle
 * @property {string} title       Titulo limpio, presentable.
 * @property {string|null} artist Artista derivado (uploader limpio o
 *                                left-of-split). Null si no se pudo
 *                                inferir nada confiable.
 * @property {'high'|'medium'|'low'} confidence  Nivel de certeza.
 */

/**
 * Aplica los pasos 1-5 (cleaning de string puro, sin inferir artist).
 * Helper interno.
 * @param {string} s
 * @returns {string}
 */
function stripMarkers(s) {
  if (!s) return '';
  let out = String(s);

  // Tier 1: parens markers (Official Video, HD, 4K, ...).
  // Loop hasta estabilizar — algunos titulos tienen markers anidados o
  // multiples markers adyacentes que requieren dos pasadas.
  let prev;
  do {
    prev = out;
    out = out.replace(PARENS_MARKERS, ' ');
  } while (out !== prev);

  // Tier 1.5: trailing markers tras "- ".
  do {
    prev = out;
    out = out.replace(TRAILING_MARKERS, '');
  } while (out !== prev);

  // Tier 1: caracteres decorativos en bordes.
  out = out.replace(DECORATIVE_EDGES, '');

  // feat/ft normalizacion (no eliminar, solo unificar formato).
  out = out.replace(FEAT_PARENS, (_m, who) => `(feat. ${who.trim()})`);
  out = out.replace(FEAT_BARE, (_m, who) => `(feat. ${who.trim()})`);

  // Cleanup final.
  out = out.replace(EMPTY_BRACKETS, ' ');
  out = out.replace(MULTI_SPACE, ' ').trim();
  return out;
}

/**
 * Heuristica para detectar si la "izquierda" de un split por dash
 * parece nombre de artista real (1-4 palabras, no es articulo/preposicion).
 *
 * Evita falsos positivos como "Don't Stop Me Now" donde "Don't Stop Me Now"
 * NO es un artista. Pero permite "21 Pilots", "M83", "Imagine Dragons".
 *
 * @param {string} candidate
 * @returns {boolean}
 */
function looksLikeArtistName(candidate) {
  if (!candidate) return false;
  const trimmed = candidate.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 4) return false;
  // Rechaza si empieza con palabra obviamente NO-artista.
  const firstWord = words[0].toLowerCase();
  const NON_ARTIST_FIRST = new Set([
    "don't", 'dont', 'do', "can't", 'cant', 'will', 'when', 'why', 'where',
    'what', 'who', 'how', 'i', "i'm", 'im', 'my', 'we', 'they', 'you',
    'a', 'an', 'the', 'this', 'that', 'these', 'those',
  ]);
  if (NON_ARTIST_FIRST.has(firstWord)) return false;
  return true;
}

/**
 * Limpia un titulo crudo de YouTube + uploader, devuelve metadata
 * presentable.
 *
 * @param {object} input
 * @param {string} input.rawTitle      Titulo crudo (de Innertube o yt-dlp).
 * @param {string|null} [input.rawUploader]  Channel name del uploader.
 * @returns {CleanedTitle}
 */
export function cleanYoutubeTitle({ rawTitle, rawUploader = null }) {
  const stripped = stripMarkers(rawTitle ?? '');

  // Detectar "-Topic" en uploader como senial de alta confianza.
  const isTopicChannel = !!rawUploader && UPLOADER_TOPIC_SUFFIX.test(String(rawUploader));

  // Decision de split: solo si uploader es generico/sello.
  const cleanedUploader = cleanUploader(rawUploader);
  const uploaderIsGeneric = isGenericUploader(rawUploader)
                         || isGenericUploader(cleanedUploader);

  if (uploaderIsGeneric && DASH_SEPARATOR.test(stripped)) {
    // Split solo en el PRIMER separador.
    const idx = stripped.search(DASH_SEPARATOR);
    const matchLen = stripped.match(DASH_SEPARATOR)[0].length;
    const left = stripped.slice(0, idx).trim();
    const right = stripped.slice(idx + matchLen).trim();

    if (looksLikeArtistName(left) && right.length > 0) {
      // Aplicar stripMarkers DE NUEVO al right (puede tener markers
      // residuales que no se vieron antes por estar fuera del titulo
      // principal).
      const cleanRight = stripMarkers(right);
      return {
        title: cleanRight || right,
        artist: left,
        confidence: isTopicChannel ? 'high' : 'medium',
      };
    }
  }

  // Sin split: devolver title limpio + uploader limpio como artist.
  return {
    title: stripped,
    artist: cleanedUploader,
    confidence: isTopicChannel ? 'high' : (cleanedUploader ? 'medium' : 'low'),
  };
}
