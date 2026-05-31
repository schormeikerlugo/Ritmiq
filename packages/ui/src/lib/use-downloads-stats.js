/**
 * useDownloadsStats — estadísticas de descargas locales (nº de canciones +
 * peso ocupado), reutilizable en desktop y PWA.
 *
 *   - Desktop: el peso real en disco lo provee el IPC
 *     `library:downloadsStats` (suma de statSync de los .opus).
 *   - PWA: el peso viene de los blobs de IndexedDB (`listLocalDownloads`).
 *
 * Devuelve `{ count, totalSize, sizeByTrack, refresh }`. `count` se cuenta
 * sobre los tracks de la biblioteca que están realmente descargados, no
 * sobre filas huérfanas.
 *
 * @module @ritmiq/ui/lib/use-downloads-stats
 */
import { useCallback, useEffect, useState } from 'react';
import { useLibraryStore } from '../stores/library.js';
import { useAuthStore } from '../stores/auth.js';
import { isDesktop, api } from './api.js';
import { listLocalDownloads } from './local-downloads.js';

export function useDownloadsStats() {
  const tracks = useLibraryStore((s) => s.tracks);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [state, setState] = useState({ count: 0, totalSize: 0, sizeByTrack: {} });

  const refresh = useCallback(async () => {
    if (isDesktop) {
      const downloaded = tracks.filter((t) => t.isDownloaded);
      let sizeByTrack = {};
      let totalSize = 0;
      try {
        const stats = await api.libraryDownloadsStats?.(userId);
        if (stats && typeof stats === 'object') {
          sizeByTrack = stats.sizeByTrack ?? {};
          totalSize = stats.totalSize ?? 0;
        }
      } catch {
        // Preload viejo sin el método: el conteo igual funciona.
      }
      setState({ count: downloaded.length, totalSize, sizeByTrack });
      return;
    }
    // PWA: cruzar los blobs de IndexedDB con la biblioteca.
    const items = await listLocalDownloads();
    const sizeByTrack = {};
    for (const it of items) sizeByTrack[it.trackId] = it.size ?? 0;
    const downloaded = tracks.filter((t) => sizeByTrack[t.id] != null);
    const totalSize = downloaded.reduce((acc, t) => acc + (sizeByTrack[t.id] ?? 0), 0);
    setState({ count: downloaded.length, totalSize, sizeByTrack });
  }, [tracks, userId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...state, refresh };
}
