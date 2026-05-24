#!/usr/bin/env node
/**
 * Wipe + re-backfill de la tabla Supabase tracks_global con cleaning
 * aplicado via packages/core/src/clean-track-meta/.
 *
 * USO:
 *   node scripts/wipe-and-rebackfill-tracks-global.mjs --dry
 *     → solo loguea 20 filas con before/after, no toca BD.
 *   node scripts/wipe-and-rebackfill-tracks-global.mjs --live
 *     → DELETE + INSERT real. Requiere --i-confirm para evitar accidentes.
 *
 * REQUISITOS:
 *   - .env.local con SUPABASE_ACCESS_TOKEN.
 *   - SQLite local del desktop en ~/.config/@ritmiq/desktop/ritmiq.sqlite
 *     (se lee `tracks WHERE is_downloaded=1`).
 *
 * EL SCRIPT:
 *   1. Lee SQLite local (348 tracks descargados).
 *   2. Aplica cleanYoutubeTitle({rawTitle, rawUploader}) a cada uno.
 *   3. En --dry: muestra 20 filas representativas (cambios reales primero).
 *   4. En --live: DELETE FROM tracks_global, luego INSERT en batches de 10.
 *
 * El UA de curl es necesario para bypass de Cloudflare error 1010 en
 * Management API.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { cleanYoutubeTitle } from '../packages/core/src/clean-track-meta/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = 'gukzacuwcaqgkzchghcg';
const ROOT = join(__dirname, '..');
const DB_PATH = join(homedir(), '.config', '@ritmiq', 'desktop', 'ritmiq.sqlite');

/* ─── CLI args ───────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const isDry = args.includes('--dry');
const isLive = args.includes('--live');
const isConfirmed = args.includes('--i-confirm');

if (!isDry && !isLive) {
  console.error('USO: --dry  o  --live --i-confirm');
  process.exit(1);
}
if (isLive && !isConfirmed) {
  console.error('--live requiere ADEMAS --i-confirm para ejecutar');
  process.exit(1);
}

/* ─── Cargar SUPABASE_ACCESS_TOKEN ──────────────────────────────── */

function loadEnv() {
  const envContent = readFileSync(join(ROOT, '.env.local'), 'utf8');
  for (const line of envContent.split('\n')) {
    if (line.startsWith('SUPABASE_ACCESS_TOKEN=')) {
      return line.split('=').slice(1).join('=').trim();
    }
  }
  throw new Error('SUPABASE_ACCESS_TOKEN no encontrado en .env.local');
}

const SBP = loadEnv();

/* ─── Leer SQLite local ──────────────────────────────────────────── */

function loadFromSqlite() {
  const sql = `
    SELECT yt_id, title, artist, album, cover_url, duration_seconds
    FROM tracks
    WHERE is_downloaded = 1
      AND yt_id IS NOT NULL AND yt_id != ''
      AND title IS NOT NULL AND title != ''
      AND LENGTH(yt_id) = 11
    ORDER BY created_at DESC
    LIMIT 1000;
  `.trim();
  const out = execSync(
    `sqlite3 -json "${DB_PATH}" "${sql.replace(/\n/g, ' ')}"`,
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  return JSON.parse(out.trim() || '[]');
}

/* ─── Aplicar cleaning ──────────────────────────────────────────── */

function applyClean(rows) {
  return rows.map((row) => {
    const cleaned = cleanYoutubeTitle({
      rawTitle: row.title,
      rawUploader: row.artist,
    });
    return {
      ytId: row.yt_id,
      original: { title: row.title, artist: row.artist },
      cleaned: {
        title: cleaned.title || row.title,
        artist: cleaned.artist || row.artist || 'Desconocido',
      },
      album: row.album,
      coverUrl: row.cover_url,
      durationSeconds: row.duration_seconds,
      confidence: cleaned.confidence,
      changed: cleaned.title !== row.title || cleaned.artist !== row.artist,
    };
  });
}

/* ─── Management API helper ─────────────────────────────────────── */

async function runQuery(sql) {
  const payload = JSON.stringify({ query: sql });
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SBP}`,
        'Content-Type': 'application/json',
        'User-Agent': 'curl/7.81.0',
        Accept: '*/*',
      },
      body: payload,
    },
  );
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

function escSql(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function escInt(n) {
  if (n === null || n === undefined) return 'NULL';
  const num = parseInt(n, 10);
  return Number.isNaN(num) ? 'NULL' : String(num);
}

async function insertBatch(rows) {
  const values = rows.map((r) => '(' + [
    escSql(r.ytId),
    escSql(r.cleaned.title.slice(0, 500)),
    escSql(r.cleaned.artist.slice(0, 500)),
    escSql(r.album ? r.album.slice(0, 500) : null),
    escSql(r.coverUrl),
    escInt(r.durationSeconds),
  ].join(',') + ')').join(', ');
  const sql = `INSERT INTO public.tracks_global ` +
    `(yt_id, title, artist, album, cover_url, duration_seconds) VALUES ` +
    values + ` ON CONFLICT (yt_id) DO NOTHING`;
  await runQuery(sql);
}

/* ─── MAIN ──────────────────────────────────────────────────────── */

async function main() {
  console.log(`Modo: ${isDry ? 'DRY-RUN (no toca BD)' : 'LIVE (DELETE + INSERT real)'}`);
  console.log(`Leyendo SQLite: ${DB_PATH}`);

  const rows = loadFromSqlite();
  console.log(`Tracks leidos: ${rows.length}`);

  const cleaned = applyClean(rows);
  const changed = cleaned.filter((r) => r.changed);
  const unchanged = cleaned.length - changed.length;
  console.log(`Cambios detectados: ${changed.length} / ${cleaned.length} (${unchanged} ya estaban limpios).`);

  // Mostrar 20 ejemplos representativos. Prioridad: 15 con cambios + 5 sin.
  const sample = [...changed.slice(0, 15), ...cleaned.filter((r) => !r.changed).slice(0, 5)];

  console.log('\n─── MUESTRA (before → after) ───');
  for (const r of sample) {
    const marker = r.changed ? '✓' : ' ';
    console.log(`${marker} [${r.confidence}] ${r.ytId}`);
    console.log(`   IN:  title="${r.original.title}"`);
    console.log(`        artist="${r.original.artist}"`);
    console.log(`   OUT: title="${r.cleaned.title}"`);
    console.log(`        artist="${r.cleaned.artist}"`);
  }

  if (isDry) {
    console.log('\nDRY-RUN: no se toco la BD. Para aplicar:');
    console.log('  node scripts/wipe-and-rebackfill-tracks-global.mjs --live --i-confirm');
    return;
  }

  // LIVE: wipe + re-insert.
  console.log('\n─── LIVE: DELETE FROM tracks_global ───');
  const delResp = await runQuery('DELETE FROM public.tracks_global');
  console.log(`DELETE OK: ${JSON.stringify(delResp)}`);

  console.log('\n─── LIVE: INSERT en batches de 10 ───');
  const BATCH = 10;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < cleaned.length; i += BATCH) {
    const chunk = cleaned.slice(i, i + BATCH);
    try {
      await insertBatch(chunk);
      ok += chunk.length;
      process.stdout.write(`\r  insertados: ${ok}/${cleaned.length}    `);
    } catch (err) {
      fail += chunk.length;
      console.error(`\n  batch ${i + 1}-${i + chunk.length}: ${err.message}`);
    }
  }
  console.log(`\n\nResultado final: OK=${ok}, FAIL=${fail}.`);

  const final = await runQuery('SELECT COUNT(*) AS total FROM public.tracks_global');
  console.log(`Verificacion: tracks_global tiene ${final[0]?.total ?? '?'} filas.`);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err);
  process.exit(1);
});
