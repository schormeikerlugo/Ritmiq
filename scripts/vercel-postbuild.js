#!/usr/bin/env node
/**
 * Asegura que el output de la PWA quede en `<cwd>/dist` para que Vercel lo
 * encuentre, sin importar qué Root Directory tenga el proyecto.
 *
 * Casos:
 *  - Root = apps/pwa     → vite ya outputea a `./dist`, no hace nada.
 *  - Root = apps/desktop → output está en `../pwa/dist`, lo copia a `./dist`.
 *  - Root = repo raíz    → output está en `apps/pwa/dist`, lo copia a `./dist`.
 *  - Root = otra subdir  → busca `../../apps/pwa/dist`.
 */
import { existsSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';

const candidates = [
  'dist',
  '../pwa/dist',
  'apps/pwa/dist',
  '../../apps/pwa/dist',
];

const src = candidates.find((p) => existsSync(join(p, 'index.html')));

if (!src) {
  console.error('[vercel-postbuild] No build output encontrado en:', candidates);
  process.exit(1);
}

if (src === 'dist') {
  console.log('[vercel-postbuild] Output ya en ./dist');
  process.exit(0);
}

console.log(`[vercel-postbuild] Copiando ${src} -> ./dist`);
rmSync('dist', { recursive: true, force: true });
cpSync(src, 'dist', { recursive: true });
console.log('[vercel-postbuild] OK');
