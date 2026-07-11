/**
 * Detección automática del navegador a usar con `yt-dlp --cookies-from-browser`.
 *
 * YouTube empezó a bloquear a yt-dlp con "Sign in to confirm you're not a bot"
 * en 2024 incluso con `player_client` alternativos. Pasar cookies de un
 * navegador donde el usuario tenga sesión a YouTube esquiva el check.
 *
 * Override por env var: `RITMIQ_YTDLP_COOKIES_BROWSER=firefox|chrome|chromium|brave|edge|vivaldi|opera|none`.
 *
 * @module main/cookies-detect
 */

import { existsSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

/** @returns {string|null} */
export function detectCookiesBrowser() {
  const override = process.env.RITMIQ_YTDLP_COOKIES_BROWSER;
  if (override) {
    const v = override.trim().toLowerCase();
    return v === 'none' || v === '' ? null : v;
  }
  const home = homedir();
  // Firefox primero: yt-dlp lo lee en Linux sin pedir keyring. Chrome/Chromium
  // pueden fallar silenciosamente si gnome-keyring no está desbloqueado.
  const candidates = [
    { name: 'firefox',  paths: [join(home, '.mozilla/firefox')] },
    { name: 'chromium', paths: [join(home, '.config/chromium')] },
    { name: 'chrome',   paths: [join(home, '.config/google-chrome')] },
    { name: 'brave',    paths: [join(home, '.config/BraveSoftware/Brave-Browser')] },
    { name: 'edge',     paths: [join(home, '.config/microsoft-edge')] },
    { name: 'vivaldi',  paths: [join(home, '.config/vivaldi')] },
    { name: 'opera',    paths: [join(home, '.config/opera')] },
  ];
  for (const c of candidates) {
    if (c.paths.some((p) => existsSync(p))) return c.name;
  }
  return null;
}

/**
 * Detección automática de un runtime JavaScript para pasarle a yt-dlp via
 * `--js-runtimes <name>:<path>`.
 *
 * ⚠️ CRÍTICO desde yt-dlp 2025: YouTube cifra las URLs de stream con un
 * "signature challenge" y un "n challenge" que sólo pueden resolverse
 * ejecutando JavaScript. Sin un runtime JS instalado, yt-dlp devuelve
 * **solo storyboards** (imágenes) — nada de audio/vídeo — para casi
 * todos los `player_client` modernos.
 *
 * Prioridad:
 *   1. `RITMIQ_YTDLP_JS_RUNTIME` (override). Formatos válidos:
 *       - `deno` o `node`           → busca en PATH.
 *       - `deno:/ruta/al/deno`      → ruta explícita.
 *       - `none`                    → desactiva (debug).
 *   2. `deno` en PATH (recomendado por yt-dlp).
 *   3. `node` en PATH (typically `/usr/bin/node`).
 *
 * @returns {string|null} valor para `--js-runtimes` (p.ej.
 *   `'node:/usr/bin/node'` o `'deno'`), o null si no hay runtime.
 */
export function detectJsRuntime() {
  const override = process.env.RITMIQ_YTDLP_JS_RUNTIME;
  if (override) {
    const v = override.trim();
    if (v.toLowerCase() === 'none' || v === '') return null;
    return v;
  }
  for (const name of ['deno', 'node']) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0) {
      const path = r.stdout.trim();
      if (path) return `${name}:${path}`;
    }
  }
  return null;
}

/**
 * Path del archivo donde cacheamos las cookies extraídas del navegador.
 * Usar este archivo (`--cookies <ruta>`) en lugar de
 * `--cookies-from-browser <browser>` es **mucho más rápido** porque evita
 * re-extraer 1000+ cookies del browser en cada invocación de yt-dlp
 * (200-500ms cada vez, sumando 1s+ a cada play).
 */
export function getCookieFilePath() {
  return join(tmpdir(), 'ritmiq-yt-cookies.txt');
}

/**
 * Exporta cookies del navegador a un archivo Netscape-format para
 * reutilizarlo en llamadas posteriores. Operación async — la llamada
 * principal del LAN server NO debe esperarla.
 *
 * yt-dlp acepta `--cookies <file>` y `--cookies-from-browser <browser>`
 * a la vez: extrae del browser y guarda en el archivo. Ese mismo file
 * sirve para las siguientes invocaciones con solo `--cookies <file>`.
 *
 * @param {string} ytdlpBin
 * @param {string} browser  Valor de `--cookies-from-browser`.
 * @param {number} [maxAgeMs=3600000]  Si el archivo existe y es más
 *   reciente que esto, no se regenera. Default 1h.
 * @returns {Promise<string|null>} Path al archivo, o null si falló.
 */
export function exportCookiesToFile(ytdlpBin, browser, maxAgeMs = 60 * 60 * 1000) {
  const file = getCookieFilePath();
  // Si el archivo existe y es reciente, reusar.
  try {
    if (existsSync(file)) {
      const age = Date.now() - statSync(file).mtimeMs;
      if (age < maxAgeMs) return Promise.resolve(file);
    }
  } catch { /* ignore */ }

  return new Promise((resolve) => {
    // `--simulate` evita cualquier I/O extra. Usamos una URL trivial sólo
    // para forzar a yt-dlp a inicializar y volcar cookies al archivo.
    const args = [
      '--cookies-from-browser', browser,
      '--cookies', file,
      '--simulate',
      '--skip-download',
      '--no-warnings',
      '--quiet',
      'https://www.youtube.com/',
    ];
    const child = spawn(ytdlpBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('close', (code) => {
      if (code === 0 && existsSync(file)) {
        resolve(file);
      } else {
        console.warn(`[cookies-cache] exportar cookies falló (code=${code}): ${stderr.slice(0, 200)}`);
        resolve(null);
      }
    });
    child.on('error', (err) => {
      console.warn(`[cookies-cache] spawn falló: ${err.message}`);
      resolve(null);
    });
  });
}
