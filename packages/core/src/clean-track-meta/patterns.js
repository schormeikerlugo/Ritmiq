/**
 * @module @ritmiq/core/clean-track-meta/patterns
 *
 * Conjunto canonico de patrones para limpiar titulos crudos de YouTube.
 * Cada regex aqui:
 *   - Es IDEMPOTENTE: aplicarla N veces produce el mismo resultado.
 *   - Usa WHITELIST de keywords especificas en lugar de blacklist
 *     generica. Asi un titulo legitimo con paréntesis ("(Sittin' On)
 *     The Dock of the Bay") nunca se rompe.
 *   - Documenta su intencion en comentario adyacente para facilitar
 *     auditoria futura.
 *
 * MANTENER SINCRONIZADO con
 *   supabase/functions/_shared/clean-track-meta.ts (mirror Deno).
 */

/* ─────────────────────────────────────────────────────────────────────
 * TIER 1 — Markers dentro de () o [] con whitelist de keywords.
 * Ejemplos eliminados:
 *   "(Official Music Video)" "(Official Audio)" "[HD]" "[4K Upgrade]"
 *   "(Visualizer)" "(Lyric Video)" "(Remastered 2011)" "(MV)"
 * Lo que NO se elimina:
 *   "(Live at Wembley)" → "Live" no esta en la whitelist.
 *   "(Acoustic)" → idem.
 *   "(Sittin' On)" → no contiene keyword.
 *   "(feat. DaBaby)" → feat se trata en otro modulo.
 * ───────────────────────────────────────────────────────────────────── */
/* Lista de keywords trigger. Si el contenido de un paréntesis EMPIEZA
 * con cualquiera de estas, se elimina el paréntesis COMPLETO (incluyendo
 * cualquier sufijo dentro: " - Remastered", " 2011", etc.). Asi
 * "(Official Video - Remastered)" se elimina entero.
 *
 * Incluye variantes en espanol (oficial, video oficial) y portugues
 * (oficial tambien). */
const PARENS_TRIGGER_KEYWORDS = [
  'official',
  'oficial',                    // español / portugues
  'video\\s+oficial',           // "Video Oficial" → muy comun en latino
  'video\\s+official',
  'hd', 'hq', 'sd', '4k', '8k', '2k', '1080p?', '720p?', '2160p', '4320p', '480p', '360p',
  'remaster(?:ed)?',
  'remasteriz(?:ado|ada)',       // español
  'restored',
  'restaurado',                  // español
  'visualizer',
  'visualizador',                // español
  'lyric\\s+video', 'lyrics',
  'letra(?:s)?(?:\\s+oficial(?:es)?)?',  // "(Letra)" / "(Letras Oficiales)"
  'audio(?:\\s+only)?',
  'static\\s+video', 'animated\\s+video',
  'm\\/?v',
  'vertical\\s+video',
  'video\\s+vertical',
  'vevo\\s+presents',
  'music\\s+video',
  'video\\s+musical',
];

export const PARENS_MARKERS = new RegExp(
  '\\s*[\\(\\[]\\s*(?:' + PARENS_TRIGGER_KEYWORDS.join('|') + ')\\b[^\\)\\]]*[\\)\\]]\\s*',
  'gi',
);

/* ─────────────────────────────────────────────────────────────────────
 * TIER 1.5 — Trailing markers sin paréntesis al final del titulo.
 * Ejemplos eliminados:
 *   "Don't Stop Me Now - Remastered 2011" → "Don't Stop Me Now"
 *   "In the End | Official Video" → "In the End"
 *   "Smells Like Teen Spirit – Music Video" → "Smells Like Teen Spirit"
 * Solo aplica tras un separador (-, –, —, |) con espacios.
 * ───────────────────────────────────────────────────────────────────── */
export const TRAILING_MARKERS = new RegExp(
  '\\s+[-\\u2013\\u2014\\|]\\s+(?:' + [
    'official\\s+(?:music\\s+)?video',
    'official\\s+audio',
    'music\\s+video',
    'lyric\\s+video',
    'lyrics',
    'audio',
    'visualizer',
    'remaster(?:ed)?(?:\\s+\\d{4})?',
    '(?:hd|hq|4k|8k|2k|1080p?|720p?)(?:\\s+remaster(?:ed)?)?',
    '4k\\s+upgrade',
  ].join('|') + ')\\s*$',
  'i',
);

/* ─────────────────────────────────────────────────────────────────────
 * TIER 1 — Caracteres decorativos al inicio/fin del titulo.
 *
 * Match SOLO en bordes (^ / $). Emojis y simbolos decorativos en
 * medio del titulo se respetan (un titulo intencional como
 * "Crazy ♥ in Love" no se debe romper).
 * ───────────────────────────────────────────────────────────────────── */
export const DECORATIVE_EDGES = new RegExp(
  '(?:^[\\s★♪►▶♫✨◆◇♬♩♭♯☆⭐\\u2600-\\u27BF\\u{1F300}-\\u{1F9FF}]+)|' +
  '(?:[\\s★♪►▶♫✨◆◇♬♩♭♯☆⭐\\u2600-\\u27BF\\u{1F300}-\\u{1F9FF}]+$)',
  'gu',
);

/* ─────────────────────────────────────────────────────────────────────
 * TIER 2 — Separador "Artista - Titulo".
 *
 * Solo se aplica si el uploader es generico/sello (cleanUploader.js
 * lo determina). El regex aqui solo IDENTIFICA si hay separador
 * candidato; la decision de SPLIT vive en title.js con la heuristica
 * de uploader.
 * ───────────────────────────────────────────────────────────────────── */
export const DASH_SEPARATOR = /\s+[-\u2013\u2014|]\s+/;

/* Lista negra de uploaders genericos / sellos discograficos / canales
 * automaticos. Si el uploader matchea alguno, asumimos que el titulo
 * lleva el artista incluido en formato "Artista - Titulo". */
export const GENERIC_UPLOADER_RE = new RegExp(
  '(?:^|\\s)(?:' + [
    'vevo',
    'topic',                   // YouTube Music auto-generated
    'records?',
    'music(?:\\s+group)?',
    'channel',
    'official\\s+channel',
    'tv',
    'media',
    'entertainment',
    'audio\\s+library',
    'lyric\\s+lounge',
    'sony\\s+music',
    'warner\\s+music',
    'universal\\s+music',
    'umg',
    'wmg',
    'atlantic\\s+records?',
    'columbia\\s+records?',
    'rca\\s+records?',
    'interscope',
    'def\\s+jam',
    'capitol\\s+records?',
  ].join('|') + ')\\s*$',
  'i',
);

/* ─────────────────────────────────────────────────────────────────────
 * UPLOADER cleaning — sufijos y prefijos comunes.
 *
 * Convierte:
 *   "LinkinParkVEVO"  → "LinkinPark"
 *   "DuaLipaMusic"    → "DuaLipa"
 *   "OficialAlejandro Sanz" → "Alejandro Sanz"
 *   "Bad Bunny - Topic" → "Bad Bunny"
 *
 * NO afecta nombres que ya sean limpios.
 * ───────────────────────────────────────────────────────────────────── */
export const UPLOADER_TOPIC_SUFFIX = /\s*-\s*Topic\s*$/i;
export const UPLOADER_SUFFIX_GLUED = /(?<=[a-z])(VEVO|TV|Music|Official)$/;
export const UPLOADER_SUFFIX_SEP = /\s+(?:Official|VEVO|TV|Music|Records|Channel)\s*$/i;
export const UPLOADER_PREFIX = /^(?:Official|Oficial)\s+/i;

/* Detecta uploader que es CLARAMENTE un canal oficial (VEVO pegado,
 * "- Topic", terminacion en Records, etc). Util para forzar split
 * "Artist - Title" cuando el uploader ya delata el formato. */
export const UPLOADER_IS_CHANNEL_RE = new RegExp(
  '(?:' + [
    '(?<=[a-z])VEVO$',          // glued VEVO
    '\\bVEVO\\b',                // standalone VEVO
    '\\s-\\s*Topic\\s*$',        // - Topic
    '\\bOfficial\\b',
    '\\bRecords?\\b',
    '\\bMusic(?:\\s+Group)?\\b',
    '\\bChannel\\b',
    '\\bTV\\b',
    '\\bEntertainment\\b',
    '\\bSony\\s+Music\\b',
    '\\bWarner\\s+Music\\b',
    '\\bUniversal\\s+Music\\b',
    '\\bUMG\\b', '\\bWMG\\b',
    '\\bAtlantic\\b', '\\bColumbia\\b', '\\bInterscope\\b',
    '\\bDef\\s+Jam\\b', '\\bCapitol\\b',
  ].join('|') + ')',
  '',
);

/* ─────────────────────────────────────────────────────────────────────
 * feat / ft / featuring — NORMALIZACION (no eliminacion).
 *
 * "Levitating (ft. DaBaby)" → "Levitating (feat. DaBaby)"
 * "Track featuring Other" → "Track (feat. Other)"
 *
 * Mantiene la info pero unifica formato.
 * ───────────────────────────────────────────────────────────────────── */
export const FEAT_BARE = /\bft\.?\s+([^()[\]]+?)(?=\s*[\[(]|$)/i;
export const FEAT_PARENS = /[\(\[]\s*ft\.?\s+([^)\]]+)[\)\]]/gi;

/* ─────────────────────────────────────────────────────────────────────
 * WHITESPACE normalize — final cleanup, idempotente.
 * Colapsa multiples espacios, elimina espacios antes de signos.
 * ───────────────────────────────────────────────────────────────────── */
export const MULTI_SPACE = /\s+/g;
// Espacios redundantes pegados a paréntesis/corchetes vacios.
export const EMPTY_BRACKETS = /\s*[\(\[]\s*[\)\]]\s*/g;
