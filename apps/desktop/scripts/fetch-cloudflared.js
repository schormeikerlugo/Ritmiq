#!/usr/bin/env node
/**
 * Descarga el binario cloudflared adecuado para la plataforma actual
 * y lo guarda en apps/desktop/bin/.
 *
 * Uso:  node scripts/fetch-cloudflared.js
 */

import { mkdirSync, createWriteStream, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binDir = join(__dirname, '..', 'bin');
mkdirSync(binDir, { recursive: true });

const platform = process.platform;
const arch = process.arch;

let target;
if (platform === 'win32') {
  target = arch === 'arm64' ? 'cloudflared-windows-arm64.exe' : 'cloudflared-windows-amd64.exe';
} else if (platform === 'darwin') {
  // macOS distribuye un .tgz que requiere descomprimir; por simplicidad
  // dejamos esto pendiente. El usuario macOS instalaría via homebrew.
  console.log('[fetch-cloudflared] macOS no soportado en auto-descarga (usa homebrew install cloudflared).');
  process.exit(0);
} else {
  target = arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64';
}

const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${target}`;
const out = join(binDir, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

if (existsSync(out)) {
  console.log(`[fetch-cloudflared] already present: ${out}`);
  process.exit(0);
}

console.log(`[fetch-cloudflared] downloading ${url}`);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) {
  console.error(`[fetch-cloudflared] HTTP ${res.status}`);
  process.exit(1);
}
await pipeline(res.body, createWriteStream(out));
if (platform !== 'win32') chmodSync(out, 0o755);
console.log(`[fetch-cloudflared] saved → ${out}`);
