import { app } from 'electron';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { applySchema } from '@ritmiq/db/sqlite';

export function initDb() {
  const path = join(app.getPath('userData'), 'ritmiq.sqlite');
  const db = new Database(path);
  applySchema(db);
  return db;
}
