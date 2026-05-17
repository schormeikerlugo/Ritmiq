/**
 * Carga manual de variables de entorno desde `.env.production` (o
 * `.env.development` si la app corre con `--dev`) para el proceso main
 * de Electron. Sin dotenv como dependencia — parser minimal.
 *
 * El main NO va por Vite, así que `import.meta.env` no aplica aquí.
 * Las variables VITE_* las consume el renderer; estas (`RITMIQ_*`) son
 * exclusivas del proceso main: service role keys, secrets, etc.
 *
 * @module main/env
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Localiza `.env.production` (o `.env.development` si estamos en dev).
 * Busca en:
 *   1. CWD (cuando se lanza desde monorepo root)
 *   2. resourcesPath/.env.production (en AppImage empaquetado, si se incluye)
 *   3. Path relativo al main file (fallback dev)
 */
function findEnvFile() {
  const filename = app.isPackaged ? '.env.production' : '.env.development';
  const candidates = [
    join(process.cwd(), filename),
    app.isPackaged ? join(process.resourcesPath, filename) : null,
    join(__dirname, '..', '..', '..', filename),
    join(__dirname, '..', '..', '..', '..', filename),
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Parser de .env minimal: ignora comentarios y líneas vacías, soporta
 * `KEY=value` con comillas simples/dobles opcionales. NO interpola
 * variables `${OTHER}` — para eso usaríamos dotenv-expand. No nos hace
 * falta hoy.
 *
 * @param {string} content
 * @returns {Record<string, string>}
 */
function parseEnv(content) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Carga env file al proceso. Las variables ya presentes en process.env
 * NO se sobreescriben — eso permite overrides externos.
 */
export function loadEnv() {
  const file = findEnvFile();
  if (!file) {
    console.warn('[env] no .env file found — variables RITMIQ_* sin cargar');
    return;
  }
  try {
    const content = readFileSync(file, 'utf8');
    const parsed = parseEnv(content);
    let loaded = 0;
    for (const [k, v] of Object.entries(parsed)) {
      // No overridear si ya está seteado (env externa gana).
      if (process.env[k] === undefined) {
        process.env[k] = v;
        loaded++;
      }
    }
    console.log(`[env] cargado ${file} (${loaded} variables nuevas)`);
  } catch (err) {
    console.warn(`[env] error leyendo ${file}: ${err.message}`);
  }
}
