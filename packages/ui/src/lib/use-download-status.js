/**
 * Hook que devuelve el estado de descarga para un track determinado.
 * Combina el flag persistente `isDownloaded` (biblioteca) con el estado
 * efímero de la cola (`useDownloadsStore`) para mostrar el spinner correcto.
 *
 * @param {string} trackId
 * @param {boolean} isDownloaded
 * @returns {'idle'|'queued'|'running'|'done'|'error'}
 */
import { useDownloadsStore } from '../stores/downloads.js';

export function useDownloadStatus(trackId, isDownloaded) {
  const entry = useDownloadsStore((s) => s.entries.find((e) => e.trackId === trackId));
  if (entry?.status === 'running') return 'running';
  if (entry?.status === 'queued') return 'queued';
  if (entry?.status === 'error') return 'error';
  if (isDownloaded) return 'done';
  return 'idle';
}

/** Devuelve el progreso 0..100 si la entrada está corriendo. */
export function useDownloadProgress(trackId) {
  const entry = useDownloadsStore((s) => s.entries.find((e) => e.trackId === trackId));
  return entry?.progress ?? 0;
}
