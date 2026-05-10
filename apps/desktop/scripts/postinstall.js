#!/usr/bin/env node
/**
 * Wrapper de postinstall para apps/desktop.
 *
 * En CI/Vercel/Netlify saltamos los pasos nativos (descargar yt-dlp y
 * recompilar better-sqlite3 contra ABI de Electron) porque ese entorno
 * no construye el desktop, solo la PWA.
 *
 * En local, ejecutamos los dos pasos en secuencia.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isCI = Boolean(
  process.env.VERCEL ||
  process.env.NETLIFY ||
  process.env.CI ||
  process.env.RITMIQ_SKIP_DESKTOP_POSTINSTALL
);

if (isCI) {
  console.log('[ritmiq/desktop] CI/Vercel detected, skipping postinstall');
  process.exit(0);
}

// 1. Descargar binario yt-dlp si falta.
const ytFetchScript = join(__dirname, 'fetch-ytdlp.js');
if (existsSync(ytFetchScript)) {
  const a = spawnSync(process.execPath, [ytFetchScript], { stdio: 'inherit' });
  if (a.status !== 0) {
    console.error('[ritmiq/desktop] fetch-ytdlp.js failed');
    process.exit(a.status ?? 1);
  }
} else {
  console.warn('[ritmiq/desktop] fetch-ytdlp.js not found, skipping');
}

// 1b. Descargar binario cloudflared si falta.
const cfFetchScript = join(__dirname, 'fetch-cloudflared.js');
if (existsSync(cfFetchScript)) {
  const a = spawnSync(process.execPath, [cfFetchScript], { stdio: 'inherit' });
  if (a.status !== 0) {
    console.warn('[ritmiq/desktop] fetch-cloudflared.js failed (no fatal)');
  }
}

// 2. Recompilar better-sqlite3 contra el ABI de Electron.
//    Si no está @electron/rebuild en node_modules (cosa rara), continuamos.
const rebuild = spawnSync(
  'npx',
  ['--no-install', 'electron-rebuild', '-f', '-w', 'better-sqlite3'],
  { stdio: 'inherit' }
);
if (rebuild.status !== 0) {
  console.warn('[ritmiq/desktop] electron-rebuild failed (no es fatal en algunos entornos)');
}

process.exit(0);
