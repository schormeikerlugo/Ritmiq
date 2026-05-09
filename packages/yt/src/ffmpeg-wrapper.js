/**
 * Wrapper mínimo para ffmpeg. Por ahora yt-dlp invoca a ffmpeg internamente,
 * así que este módulo se mantiene como placeholder para tareas futuras
 * (recortes, fade, normalización ReplayGain, transcodificación a formatos
 * distintos, etc).
 *
 * @module @ritmiq/yt/ffmpeg
 */

import { spawn } from 'node:child_process';

/**
 * @param {string[]} args
 * @returns {Promise<string>}
 */
export function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
    });
  });
}
