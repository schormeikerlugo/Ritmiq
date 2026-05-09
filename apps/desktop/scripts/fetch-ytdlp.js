#!/usr/bin/env node
/**
 * Descarga el binario yt-dlp adecuado para la plataforma actual
 * y lo guarda en apps/desktop/bin/.
 *
 * Uso:  node scripts/fetch-ytdlp.js
 */

import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmodSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binDir = join(__dirname, '..', 'bin');
mkdirSync(binDir, { recursive: true });

const platform = process.platform;
const target = platform === 'win32' ? 'yt-dlp.exe'
             : platform === 'darwin' ? 'yt-dlp_macos'
             : 'yt-dlp';
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${target}`;
const out = join(binDir, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

if (existsSync(out)) {
  console.log(`[fetch-ytdlp] already present: ${out}`);
  process.exit(0);
}

console.log(`[fetch-ytdlp] downloading ${url}`);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) {
  console.error(`[fetch-ytdlp] HTTP ${res.status}`);
  process.exit(1);
}
await pipeline(res.body, createWriteStream(out));
if (platform !== 'win32') chmodSync(out, 0o755);
console.log(`[fetch-ytdlp] saved → ${out}`);
