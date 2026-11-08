/**
 * Sincronizar una letra con el audio usando Whisper (whisper.cpp, RX 570 vía
 * Vulkan; si no hay GPU, CPU). Ver lyrics-sync.js.
 *
 * 1. Audio del vídeo (shared-audio o descarga) → WAV 16 kHz mono (ffmpeg).
 * 2. whisper-cli con tiempos por palabra (-ml 1 -sow -oj).
 * 3. alignLines(): cada línea de la letra se busca en orden en las palabras
 *    reconocidas (ventana con parecido ≥ 50 %); su tiempo es el de la primera
 *    palabra coincidente. Las no encontradas se interpolan entre vecinas o,
 *    si la letra traía tiempos de otra versión, con su tiempo + desfase medio.
 *
 * @module @ritmiq/server-core/whisper-align
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { simple } from './lyrics-sync.js';

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin';
const MODEL_FILE = 'ggml-medium-q5_0.bin';

/* ── Alineación (pura, testeable) ─────────────────────────────────── */

const tokens = (s) => simple(s).split(' ').filter(Boolean);

/** Líneas de una letra sin tiempos (fuera vacías y marcas tipo [Chorus]). */
export function plainLines(plain) {
  return String(plain ?? '').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\[.*\]$/.test(l) && !/^\(.*\)$/.test(l));
}

/**
 * @param {Array<{ text: string, hintMs?: number|null }>} lines
 * @param {Array<{ t: number, w: string }>} words  palabras reconocidas (w ya simplificada)
 * @returns {{ times: Array<number|null>, matched: number, offsetMs: number|null }}
 */
export function alignLines(lines, words) {
  const times = new Array(lines.length).fill(null);
  let p = 0;
  let matched = 0;
  const deltas = [];
  for (let li = 0; li < lines.length; li++) {
    const L = tokens(lines[li].text);
    if (L.length === 0) continue;
    const span = L.length + 3;
    let best = null;
    const limit = Math.min(words.length, p + 400);
    for (let i = p; i < limit; i++) {
      // Coincidencias de la línea dentro de la ventana [i, i+span).
      const win = words.slice(i, i + span).map((x) => x.w);
      let hit = 0;
      let first = -1;
      for (const tok of L) {
        const k = win.indexOf(tok);
        if (k >= 0) { hit++; if (first < 0 || k < first) first = k; }
      }
      const score = hit / L.length;
      if (score >= 0.5 && (!best || score > best.score + 0.15)) best = { i: i + Math.max(0, first), score };
      if (best && best.score >= 0.9) break;
    }
    if (best) {
      times[li] = words[best.i].t;
      matched++;
      p = best.i + Math.max(1, Math.floor(L.length * 0.6));
      if (typeof lines[li].hintMs === 'number') deltas.push(times[li] - lines[li].hintMs);
    }
  }
  // Desfase medio (si la letra traía tiempos de otra versión).
  let offsetMs = null;
  if (deltas.length >= 3) {
    const s = deltas.slice().sort((a, b) => a - b);
    offsetMs = s[Math.floor(s.length / 2)];
  }
  // Rellenar huecos: pista + desfase, o interpolación entre vecinas.
  for (let i = 0; i < times.length; i++) {
    if (times[i] != null) continue;
    if (offsetMs != null && typeof lines[i].hintMs === 'number') { times[i] = lines[i].hintMs + offsetMs; continue; }
    let a = i - 1; while (a >= 0 && times[a] == null) a--;
    let b = i + 1; while (b < times.length && times[b] == null) b++;
    if (a >= 0 && b < times.length) times[i] = Math.round(times[a] + ((times[b] - times[a]) * (i - a)) / (b - a));
    else if (a >= 0) times[i] = times[a] + 3000 * (i - a);
    else if (b < times.length) times[i] = Math.max(0, times[b] - 3000 * (b - i));
  }
  // Monotonía (un tiempo nunca anterior al de la línea previa).
  for (let i = 1; i < times.length; i++) {
    if (times[i] != null && times[i - 1] != null && times[i] < times[i - 1]) times[i] = times[i - 1] + 300;
  }
  return { times, matched, offsetMs };
}

/* ── Ejecución ────────────────────────────────────────────────────── */

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    child.stdout.on('data', () => {});
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} timeout`)); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(err); else reject(new Error(`${cmd} ${code}: ${err.split('\n').filter(Boolean).slice(-2).join(' | ')}`));
    });
  });
}

/**
 * @param {{
 *   modelsDir: string,
 *   findAudio: (ytId: string) => Promise<string|null>,   ruta del audio
 *   binary?: string,
 *   log?: (...a: any[]) => void,
 * }} opts
 */
export function createWhisper({ modelsDir, findAudio, binary = 'whisper-cli', log = console.log }) {
  let modelReady = null;
  const stats = { runs: 0, lastMs: 0, gpu: null };

  async function ensureModel() {
    const path = join(modelsDir, MODEL_FILE);
    if (existsSync(path)) return path;
    if (!modelReady) {
      modelReady = (async () => {
        mkdirSync(modelsDir, { recursive: true });
        log('[whisper] descargando modelo medium (~540 MB)…');
        const r = await fetch(MODEL_URL);
        if (!r.ok || !r.body) throw new Error(`modelo HTTP ${r.status}`);
        const tmp = `${path}.part`;
        await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
        renameSync(tmp, path);
        log('[whisper] modelo listo');
        return path;
      })().catch((e) => { modelReady = null; throw e; });
    }
    return modelReady;
  }

  /** Palabras con tiempo del audio de un vídeo. */
  async function transcribe(ytId) {
    const audio = await findAudio(ytId);
    if (!audio) throw new Error('sin audio');
    const model = await ensureModel();
    const dir = mkdtempSync(join(tmpdir(), 'ritmiq-whisper-'));
    try {
      const wav = join(dir, 'a.wav');
      await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', audio, '-ar', '16000', '-ac', '1', wav], 120_000);
      const t0 = Date.now();
      const stderr = await run(binary, ['-m', model, '-f', wav, '-l', 'auto', '-ml', '1', '-sow', '-oj', '-of', join(dir, 'out'), '-t', '8'], 600_000);
      stats.runs++;
      stats.lastMs = Date.now() - t0;
      stats.gpu = /Vulkan0|RADV|ggml_vulkan/i.test(stderr) ? true : stats.gpu;
      const j = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
      return (j.transcription ?? [])
        .map((x) => ({ t: x.offsets?.from ?? 0, w: simple(x.text) }))
        .filter((x) => x.w);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  function toResult(source, lines, aligned) {
    const conf = lines.length ? aligned.matched / lines.length : 0;
    return {
      source,
      synced: lines.map((l, i) => ({ timeMs: aligned.times[i] ?? 0, text: l.text }))
        .map((l) => `[${fmt(l.timeMs)}]${l.text}`).join('\n'),
      offset_ms: aligned.offsetMs,
      confidence: Math.round(conf * 100) / 100,
    };
  }

  return {
    stats,
    /** Letra con tiempos de OTRA versión → tiempos de este audio. */
    async offset(t) {
      const lrc = parseLrcLines(t.lrc?.synced);
      if (lrc.length < 4) return null;
      const words = await transcribe(t.ytId);
      const lines = lrc.map((l) => ({ text: l.text, hintMs: l.timeMs }));
      const aligned = alignLines(lines, words);
      if (aligned.matched / lines.length < 0.25 && aligned.offsetMs == null) return null;
      log(`[whisper] ${t.ytId}: ${aligned.matched}/${lines.length} líneas, desfase ${aligned.offsetMs} ms, ${stats.lastMs} ms${stats.gpu ? ' (GPU)' : ''}`);
      return toResult('offset', lines, aligned);
    },
    /** Letra sin tiempos → tiempos de este audio. */
    async align(t, plain) {
      const texts = plainLines(plain);
      if (texts.length < 4) return null;
      const words = await transcribe(t.ytId);
      const lines = texts.map((text) => ({ text }));
      const aligned = alignLines(lines, words);
      log(`[whisper] ${t.ytId}: ${aligned.matched}/${lines.length} líneas alineadas, ${stats.lastMs} ms${stats.gpu ? ' (GPU)' : ''}`);
      if (aligned.matched / lines.length < 0.4) return null;
      return toResult('whisper', lines, aligned);
    },
  };
}

function fmt(ms) {
  const t = Math.max(0, Math.round(ms / 10));
  return `${String(Math.floor(t / 6000)).padStart(2, '0')}:${String(Math.floor((t % 6000) / 100)).padStart(2, '0')}.${String(t % 100).padStart(2, '0')}`;
}

/** LRC → [{ timeMs, text }] (primera marca de cada línea, sin vacías). */
export function parseLrcLines(lrc) {
  const out = [];
  for (const line of String(lrc ?? '').split(/\r?\n/)) {
    const m = /^\s*\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$/.exec(line);
    if (!m) continue;
    const text = m[4].replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;
    const ms = (Number(m[1]) * 60 + Number(m[2])) * 1000 + (m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0);
    out.push({ timeMs: ms, text });
  }
  return out;
}
