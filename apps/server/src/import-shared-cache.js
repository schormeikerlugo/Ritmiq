#!/usr/bin/env node
/**
 * Importa/re-indexa archivos de audio compartido sueltos en el directorio
 * `shared-audio/` del servidor a la tabla `shared_audio`.
 *
 * Uso principal: migrar el caché de archivos de la app desktop al servidor
 * headless. Se copian los `<ytId>.m4a` al `shared-audio/` del servidor (por
 * tar/scp) y luego este script los registra para que el servidor los sirva
 * al instante (cache HIT) sin re-descargar.
 *
 * A diferencia de `backfillSharedAudio` (que indexa desde la tabla `tracks`
 * del owner), este script indexa por NOMBRE DE ARCHIVO: cada `<ytId>.m4a`
 * cuyo nombre-base sea un ytId de YouTube (11 chars) se registra con
 * `yt_id = <basename>`.
 *
 * Idempotente: re-ejecutarlo solo actualiza tamaños/rutas.
 *
 *   node apps/server/src/import-shared-cache.js
 *
 * @module @ritmiq/server/import-shared-cache
 */
import { loadEnv } from './env.js';
loadEnv();

import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { setHost, initDb } from '@ritmiq/server-core';
import { resolveDataDir } from './config.js';

// ytId de YouTube: 11 caracteres [A-Za-z0-9_-].
const YT_ID_RE = /^[\w-]{11}$/;

const MIME_BY_EXT = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
};

function main() {
  const dataDir = resolveDataDir();
  setHost({ dataDir, safeStorage: null, resourcesBinDir: null, devBinDir: null });

  const sharedDir = join(dataDir, 'shared-audio');
  const db = initDb();

  // INSERT inline (mismo contrato que registerSharedAudio de @ritmiq/db) para
  // no depender del paquete @ritmiq/db, que puede no estar resoluble en el
  // contenedor (solo @ritmiq/server-core está en las deps del server).
  const upsert = db.prepare(/* sql */ `
    INSERT INTO shared_audio (yt_id, file_path, mime, size, downloaded_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(yt_id) DO UPDATE SET
      file_path = excluded.file_path,
      mime = excluded.mime,
      size = excluded.size,
      downloaded_at = excluded.downloaded_at
  `);
  const registerSharedAudio = (_db, { ytId, filePath, mime, size }) => {
    if (!ytId || !filePath) return;
    upsert.run(ytId, filePath, mime, size, new Date().toISOString());
  };

  let files;
  try {
    files = readdirSync(sharedDir);
  } catch (err) {
    console.error(`[import] no se pudo leer ${sharedDir}: ${err?.message ?? err}`);
    process.exit(1);
  }

  let indexed = 0;
  let skipped = 0;
  let bytes = 0;

  for (const name of files) {
    const ext = extname(name).toLowerCase();
    const ytId = basename(name, ext);
    if (!YT_ID_RE.test(ytId)) { skipped++; continue; }
    // Solo formatos servibles universalmente. m4a es el objetivo del caché
    // compartido (iOS/Safari-friendly); el resto se ignora para no romper
    // reproducción en móviles.
    if (ext !== '.m4a' && ext !== '.mp4') { skipped++; continue; }

    const filePath = join(sharedDir, name);
    let size = 0;
    try {
      size = statSync(filePath).size;
    } catch { skipped++; continue; }
    if (size <= 0) { skipped++; continue; }

    registerSharedAudio(db, {
      ytId,
      filePath,
      mime: MIME_BY_EXT[ext] ?? 'audio/mp4',
      size,
    });
    indexed++;
    bytes += size;
  }

  const totalMB = (bytes / (1024 * 1024)).toFixed(1);
  console.log(`[import] indexados ${indexed} archivos (${totalMB} MB), omitidos ${skipped}`);
  try { db.close?.(); } catch {}
}

main();
