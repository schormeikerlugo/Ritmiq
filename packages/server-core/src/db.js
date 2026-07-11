/**
 * Inicializa la base SQLite del server-core en `<dataDir>/ritmiq.sqlite`.
 * El dataDir viene del host (Electron userData o RITMIQ_DATA_DIR headless).
 *
 * @module @ritmiq/server-core/db
 */
import Database from 'better-sqlite3';
import { applySchema } from '@ritmiq/db/sqlite';
import { dataPath } from './host.js';

export function initDb() {
  const path = dataPath('ritmiq.sqlite');
  const db = new Database(path);
  applySchema(db);
  return db;
}
