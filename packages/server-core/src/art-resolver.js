/**
 * Portadas oficiales y fotos de artista para canciones de YouTube.
 *
 * Las canciones llegan con títulos "sucios" de YouTube ("Numb (Official Music
 * Video) [4K UPGRADE]", "Harry Styles - As It Was") y su miniatura es un
 * fotograma del vídeo (o el gris de "vídeo no disponible"). Este módulo:
 *
 *   1. Limpia el título y separa "Artista - Título" (parseTrack).
 *   2. Busca candidatos en iTunes (portada oficial) y Deezer (portada 1000 px
 *      + foto del artista). Sin claves de API.
 *   3. Puntúa cada candidato (título, artista, duración; penaliza karaoke,
 *      covers, remixes o directos que no estaban en el original) y acepta el
 *      mejor si supera el umbral (scoreCandidate / ACCEPT_SCORE).
 *   4. Descarga las imágenes UNA vez a `<dataDir>/art/` (300 y 1000 px) y
 *      guarda el resultado en SQLite (`art_cache`), también los "no
 *      encontrado", para no repetir búsquedas.
 *   5. Publica el resultado en Supabase (`track_art`) para todos los
 *      dispositivos (callback `publish`).
 *
 * Cola con una búsqueda cada ~3 s (iTunes admite ~20 por minuto).
 *
 * @module @ritmiq/server-core/art-resolver
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const ACCEPT_SCORE = 0.62;
// iTunes admite ~20 búsquedas/min: lo pedido por las apps va más rápido y la
// pasada automática más despacio. Si iTunes limita (403/429), solo Deezer 1 min.
const FAST_INTERVAL_MS = 1500;
const SLOW_INTERVAL_MS = 3500;
let itunesBlockedUntil = 0;
const RETRY_NONE_MS = 30 * 24 * 3600_000; // reintentar "no encontrado" al mes
const FETCH_TIMEOUT_MS = 8000;

/* ── Normalización ─────────────────────────────────────────────────── */

const NOISE = /\b(official|oficial|video|vídeo|videoclip|clip|audio|lyrics?|letra|lyric video|visuali[sz]er|hd|hq|4k|8k|uhd|remaster(ed)?|upgrade|mv|m\/v|explicit|music video|full album|color coded|subtitulad[oa]|sub(s|titles)?|español|english|with lyrics)\b/i;
const VARIANT = /\b(remix|live|en vivo|directo|acoustic|ac[uú]stic[oa]|covers?|karaoke|instrumental|sped up|slowed|nightcore|8[- ]?bit|tribute|lullaby|piano version|edit)\b/i;

/** Minúsculas, sin acentos ni signos. */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Canal de YouTube → nombre de artista plausible. */
export function cleanArtist(a) {
  return String(a ?? '')
    .replace(/\s*-\s*topic$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\b(official|oficial)\b.*$/i, '')
    .replace(/[⚡✓✔]/g, '')
    .trim();
}

/**
 * Título de YouTube → { title, artist, variants } limpios.
 * @param {{ title?: string, artist?: string }} t
 */
export function parseTrack(t) {
  let raw = String(t?.title ?? '').replace(/[⚡✓✔]/g, ' ');
  const variants = new Set();
  // Paréntesis/corchetes: fuera si son ruido; si indican variante, se anota.
  raw = raw.replace(/([\(\[\{【])([^\)\]\}】]*)[\)\]\}】]/g, (m, open, inner) => {
    const v = inner.match(VARIANT);
    if (v) variants.add(norm(v[1]));
    // Corchetes casi nunca son parte del título ("[POST PUNK VENEZOLANO]").
    if (open !== '(' || NOISE.test(inner) || v || /\b(ft|feat|featuring|prod)\b/i.test(inner)) return ' ';
    return m;
  });
  raw = raw.replace(/\s+(ft\.?|feat\.?|featuring)\s+.*$/i, '');
  raw = raw.replace(/\s*[|｜]\s*.*$/, '');
  const channel = cleanArtist(t?.artist);
  let artist = channel;
  let title = raw;
  /** Orientación alternativa si "A - B" es ambiguo (se prueba si la primera falla). */
  let alt = null;
  const parts = raw.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    const left = parts[0].trim();
    const right = parts.slice(1).join(' - ').trim();
    const matches = (x) => channel && (similarity(x, channel) >= 0.8 || norm(x).includes(norm(channel)) || norm(channel).includes(norm(x)));
    if (matches(left)) { artist = left; title = right; }
    else if (matches(right)) { artist = right; title = left; }
    else {
      // Canal ajeno ("SurNervis") o sin canal: lo habitual es "Artista - Título".
      artist = left; title = right;
      alt = { artist: right, title: left };
    }
  }
  const clean = (x) => x.replace(NOISE, ' ').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  title = clean(title);
  const v2 = title.match(VARIANT);
  if (v2) variants.add(norm(v2[1]));
  const out = { title, artist: cleanArtist(artist), variants: [...variants] };
  if (alt) out.alt = { title: clean(alt.title), artist: cleanArtist(alt.artist) };
  // Sin guion y canal genérico: también probar sin artista.
  else if (parts.length < 2 && channel) out.alt = { title, artist: '' };
  return out;
}

/* ── Similitud y puntuación ────────────────────────────────────────── */

function bigrams(s) {
  const out = [];
  const x = ` ${s} `;
  for (let i = 0; i < x.length - 1; i++) out.push(x.slice(i, i + 2));
  return out;
}

/** Dice sobre bigramas (0..1), robusto a pequeñas diferencias. */
export function similarity(a, b) {
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const ba = bigrams(A);
  const bb = bigrams(B);
  const m = new Map();
  for (const g of ba) m.set(g, (m.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of bb) {
    const c = m.get(g);
    if (c) { hit++; m.set(g, c - 1); }
  }
  const dice = (2 * hit) / (ba.length + bb.length);
  // Uno contiene al otro ("as it was" ⊂ "as it was remastered").
  const contains = A.includes(B) || B.includes(A) ? 0.9 : 0;
  return Math.max(dice, contains);
}

/**
 * @param {{ title: string, artist: string, variants: string[], durationSeconds?: number|null }} q
 * @param {{ title: string, artist: string, album?: string, durationSeconds?: number|null }} c
 */
export function scoreCandidate(q, c) {
  const ts = similarity(q.title, c.title);
  const as = q.artist ? similarity(q.artist, c.artist) : 0.3;
  let s = ts * 0.55 + as * 0.3;
  if (q.durationSeconds && c.durationSeconds) {
    const d = Math.abs(q.durationSeconds - c.durationSeconds);
    s += d <= 3 ? 0.15 : d <= 8 ? 0.08 : d <= 20 ? 0 : -0.15;
  } else {
    s += 0.05;
  }
  // Variantes: karaoke/cover/remix/directo solo si el original lo era.
  const cv = `${norm(c.title)} ${norm(c.album)}`;
  for (const m of cv.matchAll(new RegExp(VARIANT.source, 'gi'))) {
    if (!q.variants.includes(norm(m[1]))) { s -= 0.25; break; }
  }
  for (const v of q.variants) if (!cv.includes(v)) s -= 0.1;
  // Recopilatorios: a igualdad, mejor el álbum original.
  if (/\b(greatest|hits|ballads|collection|best of|compilation|now that|essentials|playlist|anthems|top \d+|\d0s|\d0's|karaoke|workout|party)\b/i.test(c.album ?? '')) s -= 0.06;
  // Colaboración que el original no tiene ("The Goo Goo Dolls & Steve Aoki").
  if (q.artist && /(\s&\s|\bfeat\.?\b|\bft\.?\b|\bwith\b|\sx\s|,)/i.test(c.artist)
      && !/(&|feat|ft\.|with| x |,)/i.test(q.artist) && norm(c.artist) !== norm(q.artist)) {
    s -= 0.1;
  }
  return Math.max(0, Math.min(1, s));
}

/* ── Fuentes ───────────────────────────────────────────────────────── */

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Ritmiq/1.0 (portadas)' } });
    if (!r.ok) {
      if ((r.status === 403 || r.status === 429) && url.includes('itunes.apple.com')) itunesBlockedUntil = Date.now() + 60_000;
      throw new Error(`HTTP ${r.status}`);
    }
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const itunesArt = (u, px) => (u ? u.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${px}x${px}bb.jpg`) : null);
// Deezer: sin foto propia el hash va vacío ("/artist//…").
const deezerImg = (u) => (u && !/\/(artist|cover)\/\//.test(u) ? u : null);

async function searchItunes(q) {
  const term = encodeURIComponent(`${q.artist} ${q.title}`.trim());
  const j = await getJson(`https://itunes.apple.com/search?term=${term}&entity=song&limit=10`);
  return (j.results ?? []).filter((r) => r.artworkUrl100).map((r) => ({
    source: 'itunes',
    title: r.trackName ?? '',
    artist: r.artistName ?? '',
    album: r.collectionName ?? '',
    year: r.releaseDate ? Number(String(r.releaseDate).slice(0, 4)) : null,
    durationSeconds: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null,
    cover: itunesArt(r.artworkUrl100, 1000),
    coverSmall: itunesArt(r.artworkUrl100, 300),
    artistImage: null,
  }));
}

async function searchDeezer(q) {
  const strict = q.artist ? `artist:"${q.artist}" track:"${q.title}"` : q.title;
  const urls = [`https://api.deezer.com/search?q=${encodeURIComponent(strict)}&limit=10`];
  if (q.artist) urls.push(`https://api.deezer.com/search?q=${encodeURIComponent(`${q.artist} ${q.title}`)}&limit=10`);
  for (const u of urls) {
    const j = await getJson(u);
    const rows = (j.data ?? []).map((r) => ({
      source: 'deezer',
      title: r.title ?? '',
      artist: r.artist?.name ?? '',
      album: r.album?.title ?? '',
      year: null,
      durationSeconds: r.duration ?? null,
      cover: deezerImg(r.album?.cover_xl),
      coverSmall: deezerImg(r.album?.cover_medium),
      artistImage: deezerImg(r.artist?.picture_xl),
    })).filter((r) => r.cover);
    if (rows.length) return rows;
  }
  return [];
}

/** Foto del artista (Deezer). */
async function artistPhoto(name) {
  if (!name) return null;
  const j = await getJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`);
  const best = (j.data ?? [])
    .map((a) => ({ a, s: similarity(name, a.name) }))
    .filter((x) => x.s >= 0.85)
    .sort((x, y) => y.s - x.s || (y.a.nb_fan ?? 0) - (x.a.nb_fan ?? 0))[0];
  return deezerImg(best?.a.picture_xl) ?? null;
}

async function searchBoth(q) {
  const useItunes = Date.now() > itunesBlockedUntil;
  const [it, dz] = await Promise.allSettled([useItunes ? searchItunes(q) : Promise.resolve([]), searchDeezer(q)]);
  return [
    ...(it.status === 'fulfilled' ? it.value : []),
    ...(dz.status === 'fulfilled' ? dz.value : []),
  ].map((c) => ({ ...c, score: scoreCandidate(q, c) })).sort((a, b) => b.score - a.score);
}

/**
 * Candidatos puntuados (mejor primero). También lo usa "Buscar portada".
 * @param {{ title?: string, artist?: string, durationSeconds?: number|null }} track
 */
export async function findCandidates(track) {
  const parsed = parseTrack(track);
  const q = { ...parsed, durationSeconds: track?.durationSeconds ?? null };
  if (!q.title) return { query: q, candidates: [] };
  let all = await searchBoth(q);
  // Orientación alternativa ("Título - Artista", o sin artista) si no hay
  // nada convincente con la primera.
  if (parsed.alt && !(all[0]?.score >= ACCEPT_SCORE)) {
    const q2 = { ...q, ...parsed.alt };
    const more = await searchBoth(q2);
    all = [...all, ...more].sort((a, b) => b.score - a.score);
  }
  // Preferir iTunes a igualdad (portadas más cuidadas), y dedupe por portada.
  all.sort((a, b) => b.score - a.score || (a.source === 'itunes' ? -1 : 1));
  const seen = new Set();
  const candidates = all.filter((c) => {
    const k = `${norm(c.artist)}|${norm(c.album)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { query: q, candidates };
}

/* ── Caché + cola ──────────────────────────────────────────────────── */

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS art_cache (
  yt_id            TEXT PRIMARY KEY,
  status           TEXT NOT NULL,          -- 'found' | 'none'
  source           TEXT,
  score            REAL,
  matched_title    TEXT,
  matched_artist   TEXT,
  album            TEXT,
  cover_url        TEXT,                   -- CDN 1000 px
  cover_small_url  TEXT,                   -- CDN 300 px
  artist_image_url TEXT,                   -- CDN 1000 px
  has_files        INTEGER NOT NULL DEFAULT 0,
  checked_at       TEXT NOT NULL
);`;

const fileFor = (dir, ytId, kind) => join(dir, `${ytId.replace(/[^A-Za-z0-9_-]/g, '')}-${kind}.jpg`);

async function download(url, path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS * 2);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) throw new Error('imagen demasiado pequeña');
    writeFileSync(path, buf);
    return true;
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   dir: string,                                   carpeta de imágenes
 *   publish?: (row: object) => Promise<void>,      → Supabase track_art
 *   log?: (...a: any[]) => void,
 * }} opts
 */
export function createArtResolver({ db, dir, publish, log = console.log }) {
  db.exec(SCHEMA);
  // Publicado en Supabase (reintento si falló: sin sesión, red…).
  const cols = db.prepare('PRAGMA table_info(art_cache)').all().map((c) => c.name);
  if (!cols.includes('published')) db.exec('ALTER TABLE art_cache ADD COLUMN published INTEGER NOT NULL DEFAULT 0');
  const markPublished = db.prepare('UPDATE art_cache SET published = 1 WHERE yt_id = ?');
  const unpublished = db.prepare('SELECT * FROM art_cache WHERE published = 0 LIMIT ?');
  const getRow = db.prepare('SELECT * FROM art_cache WHERE yt_id = ?');
  const upsert = db.prepare(/* sql */ `
    INSERT INTO art_cache (yt_id, status, source, score, matched_title, matched_artist, album,
      cover_url, cover_small_url, artist_image_url, has_files, checked_at)
    VALUES (@yt_id, @status, @source, @score, @matched_title, @matched_artist, @album,
      @cover_url, @cover_small_url, @artist_image_url, @has_files, @checked_at)
    ON CONFLICT(yt_id) DO UPDATE SET status=excluded.status, source=excluded.source,
      score=excluded.score, matched_title=excluded.matched_title, matched_artist=excluded.matched_artist,
      album=excluded.album, cover_url=excluded.cover_url, cover_small_url=excluded.cover_small_url,
      artist_image_url=excluded.artist_image_url, has_files=excluded.has_files, checked_at=excluded.checked_at`);

  // Dos colas: lo que piden las apps (`fast`, la que suena delante) siempre
  // antes que la pasada automática de bibliotecas (`slow`).
  /** @type {Map<string, object>} */
  const fast = new Map();
  /** @type {Map<string, object>} */
  const slow = new Map();
  const queued = (id) => fast.has(id) || slow.has(id);
  let running = false;
  let lastAt = 0;
  const stats = { resolved: 0, found: 0, none: 0, errors: 0 };

  const isFresh = (row) => row && (row.status === 'found'
    || Date.now() - Date.parse(row.checked_at) < RETRY_NONE_MS);

  async function resolveOne(track) {
    const ytId = track.ytId;
    const { query, candidates } = await findCandidates(track);
    const now = new Date().toISOString();
    // El mejor candidato cuya portada se pueda descargar (algunos CDN de
    // Deezer dan 403 por región): se prueban los aceptables en orden.
    let best = null;
    let downloaded = false;
    for (const c of candidates.filter((x) => x.score >= ACCEPT_SCORE).slice(0, 4)) {
      try {
        await download(c.cover, fileFor(dir, ytId, 'cover1000'));
        await download(c.coverSmall ?? c.cover, fileFor(dir, ytId, 'cover300'));
        best = c;
        downloaded = true;
        break;
      } catch (e) {
        log(`[art] ${ytId}: portada de ${c.source} no descargable (${e?.message ?? e}), pruebo otra`);
      }
    }
    let row;
    if (best) {
      // Foto del artista: la del candidato Deezer si es el mismo artista; si
      // no, búsqueda propia del artista.
      let artistImage = candidates.find((c) => c.artistImage && similarity(c.artist, best.artist) >= 0.85)?.artistImage ?? null;
      if (!artistImage) { try { artistImage = await artistPhoto(best.artist); } catch {} }
      row = {
        yt_id: ytId, status: 'found', source: best.source, score: Math.round(best.score * 1000) / 1000,
        matched_title: best.title, matched_artist: best.artist, album: best.album,
        cover_url: best.cover, cover_small_url: best.coverSmall ?? best.cover,
        artist_image_url: artistImage, has_files: 0, checked_at: now,
      };
      row.has_files = downloaded ? 1 : 0;
      if (artistImage) {
        try { await download(artistImage, fileFor(dir, ytId, 'artist')); }
        catch { row.artist_image_url = null; }
      }
      stats.found++;
    } else {
      // Sin portada fiable: al menos la foto del artista si el canal es un artista conocido.
      let artistImage = null;
      try { artistImage = await artistPhoto(query.artist); } catch {}
      const top = candidates[0];
      row = {
        yt_id: ytId, status: 'none', source: null, score: top ? Math.round(top.score * 1000) / 1000 : null,
        matched_title: null, matched_artist: artistImage ? query.artist : null, album: null,
        cover_url: null, cover_small_url: null, artist_image_url: artistImage, has_files: 0, checked_at: now,
      };
      if (artistImage) {
        try { await download(artistImage, fileFor(dir, ytId, 'artist')); row.has_files = 1; } catch {}
      }
      stats.none++;
    }
    upsert.run(row);
    stats.resolved++;
    log(`[art] ${ytId} "${track.title}" → ${row.status}${row.status === 'found' ? ` (${row.source} ${row.score} "${row.matched_artist} – ${row.matched_title}")` : ''}`);
    if (publish) {
      publish(row).then(() => markPublished.run(ytId))
        .catch((e) => log(`[art] publicar ${ytId} falló: ${e?.message ?? e}`));
    }
    return row;
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (fast.size || slow.size) {
        const isFast = fast.size > 0;
        const q = isFast ? fast : slow;
        const [ytId, track] = q.entries().next().value;
        q.delete(ytId);
        if (isFresh(getRow.get(ytId))) continue;
        const wait = lastAt + (isFast ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS) - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastAt = Date.now();
        try { await resolveOne(track); } catch (e) { stats.errors++; log(`[art] ${ytId} error: ${e?.message ?? e}`); }
      }
    } finally {
      running = false;
    }
  }

  return {
    stats,
    /** Fila cacheada (o undefined). */
    get(ytId) { return getRow.get(ytId); },
    /**
     * Encola canciones sin resultado. Las prioritarias (la que suena) van
     * delante. Devuelve cuántas se encolaron.
     * @param {Array<{ ytId: string, title?: string, artist?: string, durationSeconds?: number|null }>} tracks
     */
    enqueue(tracks, { priority = false, background = false } = {}) {
      let n = 0;
      const fresh = [];
      for (const t of tracks) {
        if (!t?.ytId || !t.title || isFresh(getRow.get(t.ytId))) continue;
        if (background && queued(t.ytId)) continue;
        // Pedida por una app y ya en la cola lenta: pasa a la rápida.
        if (!background) slow.delete(t.ytId);
        if (!background && fast.has(t.ytId) && !priority) continue;
        fresh.push([t.ytId, t]);
        n++;
      }
      const target = background ? slow : fast;
      if (priority && fresh.length) {
        const rest = [...fast.entries()].filter(([k]) => !fresh.some(([f]) => f === k));
        fast.clear();
        for (const [k, v] of [...fresh, ...rest]) fast.set(k, v);
      } else {
        for (const [k, v] of fresh) target.set(k, v);
      }
      pump();
      return n;
    },
    pending() { return fast.size + slow.size; },
    pendingFast() { return fast.size; },
    /** Reintenta publicar en Supabase lo que quedó sin publicar. */
    async republish(limit = 200) {
      if (!publish) return 0;
      let n = 0;
      for (const row of unpublished.all(limit)) {
        try { await publish(row); markPublished.run(row.yt_id); n++; } catch { break; }
      }
      return n;
    },
    /** Ruta del archivo en disco si existe. kind: cover1000 | cover300 | artist */
    file(ytId, kind) {
      const p = fileFor(dir, ytId, kind);
      return existsSync(p) ? p : null;
    },
    findCandidates,
  };
}

/** Hash corto estable (nombres de archivo / claves). */
export function shortHash(s) {
  return createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
}
