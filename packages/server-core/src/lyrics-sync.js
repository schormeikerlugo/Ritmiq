/**
 * Letra sincronizada con el audio de UN vídeo de YouTube (yt_id).
 *
 * La función `lyrics` (Supabase) trae la letra de LRCLIB, pero sus tiempos
 * pueden no cuadrar con el vídeo que suena o no existir. Cuando el cliente lo
 * detecta, pide aquí (`POST /lyrics/sync`) una versión sincronizada con ESTE
 * audio. Orden (prioridad: siempre una letra con tiempos):
 *
 *   1. Subtítulos manuales del propio vídeo (los suben artistas/sellos): sus
 *      tiempos son exactamente los del audio. Se validan contra la letra
 *      conocida (si la hay) para no aceptar traducciones ni comentarios.
 *   2. Letra de LRCLIB de otra versión + DESFASE calculado con Whisper.
 *   3. Letra sin tiempos ALINEADA con Whisper (RX 570 vía Vulkan).
 *
 * El resultado va a Supabase `track_lyrics` (por yt_id) y a SQLite
 * (`lyrics_jobs`) para no repetir. Una tarea a la vez.
 *
 * @module @ritmiq/server-core/lyrics-sync
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RETRY_NONE_MS = 14 * 86400_000;
const SUBS_TIMEOUT_MS = 60_000;

/* ── Texto ─────────────────────────────────────────────────────────── */

export function simple(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parecido de vocabulario entre dos textos: parte del texto más corto que
 * aparece en el otro (no penaliza que uno sea más largo; una traducción no
 * comparte palabras y da ~0).
 */
export function textSimilarity(a, b) {
  const A = new Set(simple(a).split(' ').filter((w) => w.length > 2));
  const B = new Set(simple(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** Quita los tiempos de un LRC → texto. */
export function lrcText(lrc) {
  return String(lrc ?? '').replace(/\[[^\]]*\]/g, ' ');
}

function fmtTime(ms) {
  const t = Math.max(0, Math.round(ms / 10));
  const mm = Math.floor(t / 6000);
  const ss = Math.floor((t % 6000) / 100);
  const cs = t % 100;
  return `[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`;
}

/** [{ timeMs, text }] → LRC */
export function toLrc(lines) {
  return lines.map((l) => `${fmtTime(l.timeMs)}${l.text}`).join('\n');
}

/**
 * Subtítulos json3 de YouTube → líneas. Quita ♪, saltos y repeticiones
 * consecutivas idénticas.
 * @param {any} j
 */
export function parseJson3(j) {
  const out = [];
  for (const e of j?.events ?? []) {
    if (!e.segs || typeof e.tStartMs !== 'number') continue;
    const text = e.segs.map((s) => s.utf8 ?? '').join('')
      .replace(/[♪♫♬]/g, ' ').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.text === text && e.tStartMs - prev.timeMs < 1500) continue;
    out.push({ timeMs: e.tStartMs, text });
  }
  return out;
}

/* ── yt-dlp ────────────────────────────────────────────────────────── */

function ytdlp(ytOpts, extra, ytId) {
  return new Promise((resolve, reject) => {
    const args = [...extra, '--no-warnings', '--no-playlist'];
    if (ytOpts?.jsRuntime) args.push('--js-runtimes', ytOpts.jsRuntime);
    if (ytOpts?.cookiesFile) args.push('--cookies', ytOpts.cookiesFile);
    else if (ytOpts?.cookiesFromBrowser) args.push('--cookies-from-browser', ytOpts.cookiesFromBrowser);
    args.push(`https://www.youtube.com/watch?v=${ytId}`);
    const child = spawn(ytOpts?.binary ?? 'yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('yt-dlp timeout')); }, SUBS_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(err.split('\n').filter(Boolean).pop() || `yt-dlp ${code}`));
      resolve(out);
    });
  });
}

async function ytdlpJson(ytOpts, ytId) {
  return JSON.parse(await ytdlp(ytOpts, ['-J', '--skip-download'], ytId));
}

/** Descarga un subtítulo json3 con yt-dlp (YouTube exige tokens que él resuelve). */
async function downloadSub(ytOpts, ytId, lang) {
  const dir = mkdtempSync(join(tmpdir(), 'ritmiq-subs-'));
  try {
    await ytdlp(ytOpts, ['--skip-download', '--write-subs', '--no-write-auto-subs',
      '--sub-langs', lang, '--sub-format', 'json3', '-o', join(dir, 's')], ytId);
    const f = readdirSync(dir).find((x) => x.endsWith('.json3'));
    return f ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Subtítulos MANUALES del vídeo que parezcan la letra.
 * @returns {Promise<null | { lines: Array<{timeMs:number,text:string}>, lang: string, sim: number }>}
 */
export async function youtubeSubtitles(ytOpts, ytId, knownText) {
  const info = await ytdlpJson(ytOpts, ytId);
  const subs = info?.subtitles ?? {};
  let best = null;
  for (const [lang] of Object.entries(subs).slice(0, 6)) {
    if (lang === 'live_chat') continue;
    let j;
    try { j = await downloadSub(ytOpts, ytId, lang); } catch { continue; }
    if (!j) continue;
    const lines = parseJson3(j);
    if (lines.length < 6) continue;
    const text = lines.map((l) => l.text).join(' ');
    // Con letra conocida: debe parecerse (descarta traducciones/comentarios).
    const sim = knownText ? textSimilarity(text, knownText) : 0.3;
    if (knownText && sim < 0.5) continue;
    if (!best || sim > best.sim) best = { lines, lang, sim };
  }
  return best;
}

/* ── Cola ──────────────────────────────────────────────────────────── */

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS lyrics_jobs (
  yt_id      TEXT PRIMARY KEY,
  status     TEXT NOT NULL,            -- 'found' | 'none'
  source     TEXT,
  confidence REAL,
  published  INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL
);`;

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   ytOpts: object,
 *   publish?: (row: object) => Promise<void>,
 *   whisper?: null | { offset: Function, align: Function },
 *   log?: (...a: any[]) => void,
 * }} opts
 */
export function createLyricsSync({ db, ytOpts, publish, whisper = null, log = console.log }) {
  db.exec(SCHEMA);
  const getJob = db.prepare('SELECT * FROM lyrics_jobs WHERE yt_id = ?');
  const putJob = db.prepare(/* sql */ `
    INSERT INTO lyrics_jobs (yt_id, status, source, confidence, published, checked_at)
    VALUES (@yt_id, @status, @source, @confidence, 0, @checked_at)
    ON CONFLICT(yt_id) DO UPDATE SET status=excluded.status, source=excluded.source,
      confidence=excluded.confidence, published=0, checked_at=excluded.checked_at`);
  const markPublished = db.prepare('UPDATE lyrics_jobs SET published = 1 WHERE yt_id = ?');

  /** @type {Map<string, object>} */
  const queue = new Map();
  let running = false;
  const stats = { done: 0, youtube: 0, offset: 0, whisper: 0, none: 0 };

  const isFresh = (job) => job && (job.status === 'found' || Date.now() - Date.parse(job.checked_at) < RETRY_NONE_MS);

  async function processOne(t) {
    const known = t.lrc?.synced ? lrcText(t.lrc.synced) : (t.lrc?.plain ?? '');
    let result = null;

    // 1. Subtítulos del propio vídeo.
    try {
      const subs = await youtubeSubtitles(ytOpts, t.ytId, known || null);
      if (subs) result = { source: 'youtube', synced: toLrc(subs.lines), offset_ms: 0, confidence: Math.round(subs.sim * 100) / 100 };
    } catch (e) {
      log(`[lyrics] ${t.ytId} subtítulos: ${e?.message ?? e}`);
    }

    // 2/3. Whisper (desfase de una versión sincronizada / alinear texto).
    if (!result && whisper) {
      try {
        if (t.lrc?.synced) result = await whisper.offset(t);
        if (!result && known) result = await whisper.align(t, known);
      } catch (e) {
        log(`[lyrics] ${t.ytId} whisper: ${e?.message ?? e}`);
      }
    }

    const now = new Date().toISOString();
    const row = result
      ? { yt_id: t.ytId, status: 'found', ...result, updated_at: now }
      : { yt_id: t.ytId, status: 'none', source: null, synced: null, offset_ms: null, confidence: null, updated_at: now };
    putJob.run({ yt_id: row.yt_id, status: row.status, source: row.source, confidence: row.confidence, checked_at: now });
    stats.done++;
    stats[row.status === 'found' ? row.source : 'none'] = (stats[row.status === 'found' ? row.source : 'none'] ?? 0) + 1;
    log(`[lyrics] ${t.ytId} "${t.title}" → ${row.status}${row.source ? ` (${row.source}, conf ${row.confidence})` : ''}`);
    if (publish) {
      try { await publish(row); markPublished.run(row.yt_id); }
      catch (e) { log(`[lyrics] publicar ${t.ytId} falló: ${e?.message ?? e}`); }
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.size) {
        const [ytId, t] = queue.entries().next().value;
        queue.delete(ytId);
        if (isFresh(getJob.get(ytId))) continue;
        try { await processOne(t); } catch (e) { log(`[lyrics] ${ytId} error: ${e?.message ?? e}`); }
      }
    } finally {
      running = false;
    }
  }

  return {
    stats,
    /** @param {{ ytId: string, title?: string, artist?: string, durationSeconds?: number|null, lrc?: { synced?: string|null, plain?: string|null, duration?: number|null } }} t */
    enqueue(t) {
      if (!t?.ytId || queue.has(t.ytId) || isFresh(getJob.get(t.ytId))) return false;
      queue.set(t.ytId, t);
      pump();
      return true;
    },
    job(ytId) { return getJob.get(ytId); },
    pending() { return queue.size; },
  };
}
