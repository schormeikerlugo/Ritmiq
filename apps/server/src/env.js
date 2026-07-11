/**
 * Carga de variables de entorno para el servidor headless.
 *
 * Orden de búsqueda del archivo:
 *   1. RITMIQ_ENV_FILE  (ruta explícita)
 *   2. <cwd>/.env
 *   3. <cwd>/.env.production
 *   4. <repoRoot>/.env.production  (monorepo dev)
 *
 * Las variables ya presentes en process.env NO se sobreescriben (los
 * overrides del entorno del sistema / systemd ganan).
 *
 * @module @ritmiq/server/env
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findEnvFile() {
  const candidates = [
    process.env.RITMIQ_ENV_FILE || null,
    join(process.cwd(), '.env'),
    join(process.cwd(), '.env.production'),
    join(__dirname, '..', '..', '..', '.env.production'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

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
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv() {
  const file = findEnvFile();
  if (!file) {
    console.warn('[env] no .env encontrado — variables RITMIQ_* deben venir del entorno');
    return;
  }
  try {
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    let loaded = 0;
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) { process.env[k] = v; loaded++; }
    }
    console.log(`[env] cargado ${file} (${loaded} variables nuevas)`);
  } catch (err) {
    console.warn(`[env] error leyendo ${file}: ${err.message}`);
  }
}
