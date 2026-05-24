// ════════════════════════════════════════════════════════════════════════
// MIRROR DE packages/core/src/clean-track-meta/
//
// Esta es una copia self-contained TypeScript/Deno de la utility de
// cleaning. Mantener sincronizado con el original — los patrones,
// heuristicas y comportamiento deben ser IDENTICOS.
//
// Razon de duplicacion: Edge Functions corren en Deno con un sistema
// de imports distinto a Node ESM. Importar directamente desde
// packages/core via path requeriria configuracion compleja de Deno
// import_map. Es mas mantenible una copia revisada.
//
// USADO POR:
//   - supabase/functions/search-youtube/index.ts  (cleaning de raiz)
//   - supabase/functions/publish-track-meta/index.ts  (defensa)
//
// Al editar este archivo, REPLICAR cambios en
// packages/core/src/clean-track-meta/ (y viceversa).
// ════════════════════════════════════════════════════════════════════════

/* ─── PATTERNS ─────────────────────────────────────────────────────── */

const PARENS_TRIGGER_KEYWORDS = [
  'official',
  'oficial',
  'video\\s+oficial',
  'video\\s+official',
  'hd', 'hq', 'sd', '4k', '8k', '2k', '1080p?', '720p?', '2160p', '4320p', '480p', '360p',
  'remaster(?:ed)?',
  'remasteriz(?:ado|ada)',
  'restored',
  'restaurado',
  'visualizer',
  'visualizador',
  'lyric\\s+video', 'lyrics',
  'letra(?:s)?(?:\\s+oficial(?:es)?)?',
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

export const DECORATIVE_EDGES = new RegExp(
  '(?:^[\\s★♪►▶♫✨◆◇♬♩♭♯☆⭐\\u2600-\\u27BF\\u{1F300}-\\u{1F9FF}]+)|' +
  '(?:[\\s★♪►▶♫✨◆◇♬♩♭♯☆⭐\\u2600-\\u27BF\\u{1F300}-\\u{1F9FF}]+$)',
  'gu',
);

export const DASH_SEPARATOR = /\s+[-\u2013\u2014|]\s+/;

export const GENERIC_UPLOADER_RE = new RegExp(
  '(?:^|\\s)(?:' + [
    'vevo', 'topic', 'records?', 'music(?:\\s+group)?', 'channel',
    'official\\s+channel', 'tv', 'media', 'entertainment',
    'audio\\s+library', 'lyric\\s+lounge',
    'sony\\s+music', 'warner\\s+music', 'universal\\s+music',
    'umg', 'wmg', 'atlantic\\s+records?', 'columbia\\s+records?',
    'rca\\s+records?', 'interscope', 'def\\s+jam', 'capitol\\s+records?',
  ].join('|') + ')\\s*$',
  'i',
);

export const UPLOADER_TOPIC_SUFFIX = /\s*-\s*Topic\s*$/i;
export const UPLOADER_SUFFIX_GLUED = /(?<=[a-z])(VEVO|TV|Music|Official)$/;
export const UPLOADER_SUFFIX_SEP = /\s+(?:Official|VEVO|TV|Music|Records|Channel)\s*$/i;
export const UPLOADER_PREFIX = /^(?:Official|Oficial)\s+/i;

export const UPLOADER_IS_CHANNEL_RE = new RegExp(
  '(?:' + [
    '(?<=[a-z])VEVO$',
    '\\bVEVO\\b',
    '\\s-\\s*Topic\\s*$',
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

export const FEAT_BARE = /\bft\.?\s+([^()[\]]+?)(?=\s*[\[(]|$)/i;
export const FEAT_PARENS = /[\(\[]\s*ft\.?\s+([^)\]]+)[\)\]]/gi;

export const MULTI_SPACE = /\s+/g;
export const EMPTY_BRACKETS = /\s*[\(\[]\s*[\)\]]\s*/g;

/* ─── UPLOADER ─────────────────────────────────────────────────────── */

export function cleanUploader(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  if (UPLOADER_TOPIC_SUFFIX.test(s)) {
    return s.replace(UPLOADER_TOPIC_SUFFIX, '').trim();
  }
  s = s.replace(UPLOADER_SUFFIX_GLUED, '');
  s = s.replace(UPLOADER_SUFFIX_SEP, '');
  s = s.replace(UPLOADER_PREFIX, '');
  s = s.replace(MULTI_SPACE, ' ').trim();
  return s || String(raw).trim();
}

export function isGenericUploader(raw: string | null | undefined): boolean {
  if (!raw) return true;
  const s = String(raw);
  return GENERIC_UPLOADER_RE.test(s) || UPLOADER_IS_CHANNEL_RE.test(s);
}

/* ─── TITLE ────────────────────────────────────────────────────────── */

export type Confidence = 'high' | 'medium' | 'low';
export interface CleanedTitle {
  title: string;
  artist: string | null;
  confidence: Confidence;
}

function stripMarkers(s: string): string {
  if (!s) return '';
  let out = String(s);
  let prev: string;
  do {
    prev = out;
    out = out.replace(PARENS_MARKERS, ' ');
  } while (out !== prev);
  do {
    prev = out;
    out = out.replace(TRAILING_MARKERS, '');
  } while (out !== prev);
  out = out.replace(DECORATIVE_EDGES, '');
  out = out.replace(FEAT_PARENS, (_m, who) => `(feat. ${who.trim()})`);
  out = out.replace(FEAT_BARE, (_m, who) => `(feat. ${who.trim()})`);
  out = out.replace(EMPTY_BRACKETS, ' ');
  out = out.replace(MULTI_SPACE, ' ').trim();
  return out;
}

function looksLikeArtistName(candidate: string): boolean {
  if (!candidate) return false;
  const trimmed = candidate.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 4) return false;
  const firstWord = words[0].toLowerCase();
  const NON_ARTIST_FIRST = new Set([
    "don't", 'dont', 'do', "can't", 'cant', 'will', 'when', 'why', 'where',
    'what', 'who', 'how', 'i', "i'm", 'im', 'my', 'we', 'they', 'you',
    'a', 'an', 'the', 'this', 'that', 'these', 'those',
  ]);
  if (NON_ARTIST_FIRST.has(firstWord)) return false;
  return true;
}

export function cleanYoutubeTitle({
  rawTitle,
  rawUploader = null,
}: {
  rawTitle: string;
  rawUploader?: string | null;
}): CleanedTitle {
  const stripped = stripMarkers(rawTitle ?? '');
  const isTopicChannel = !!rawUploader && UPLOADER_TOPIC_SUFFIX.test(String(rawUploader));
  const cleanedUploader = cleanUploader(rawUploader);
  const uploaderIsGeneric = isGenericUploader(rawUploader) || isGenericUploader(cleanedUploader);

  if (uploaderIsGeneric && DASH_SEPARATOR.test(stripped)) {
    const idx = stripped.search(DASH_SEPARATOR);
    const m = stripped.match(DASH_SEPARATOR);
    const matchLen = m ? m[0].length : 3;
    const left = stripped.slice(0, idx).trim();
    const right = stripped.slice(idx + matchLen).trim();

    if (looksLikeArtistName(left) && right.length > 0) {
      const cleanRight = stripMarkers(right);
      return {
        title: cleanRight || right,
        artist: left,
        confidence: isTopicChannel ? 'high' : 'medium',
      };
    }
  }

  return {
    title: stripped,
    artist: cleanedUploader,
    confidence: isTopicChannel ? 'high' : (cleanedUploader ? 'medium' : 'low'),
  };
}

/* ─── NORMALIZE (para fuentes estructuradas: Spotify, Last.fm) ───── */

const MAX_TITLE = 500;
const MAX_ARTIST = 500;
const MAX_ALBUM = 500;

function tidyString(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  let out = String(s).trim();
  if (!out) return null;
  out = out.replace(MULTI_SPACE, ' ');
  if (out.length > max) out = out.slice(0, max);
  return out;
}

function tidyTitle(s: string | null | undefined): string | null {
  if (!s) return null;
  let out = String(s);
  let prev: string;
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

export function normalizeMeta({
  title = null,
  artist = null,
  album = null,
}: {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
} = {}): { title: string | null; artist: string | null; album: string | null } {
  return {
    title: tidyTitle(title),
    artist: tidyString(artist, MAX_ARTIST),
    album: tidyString(album, MAX_ALBUM),
  };
}
