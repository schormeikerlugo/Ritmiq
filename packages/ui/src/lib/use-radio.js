/**
 * Monitor del modo Radio — escucha cambios en la cola y auto-extiende
 * cuando quedan <= 2 tracks por delante Y radioMode esta activo.
 *
 * Se monta una vez al nivel de App (junto a usePlayerEngine).
 *
 * @module @ritmiq/ui/lib/use-radio
 */
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../stores/player.js';
import { buildRadioBatch } from './radio.js';

const REMAINING_THRESHOLD = 2;
const BATCH_SIZE = 12;

export function useRadioAutoExtend() {
  // Anti-double-fire: extender es sincrono pero la subscripcion puede
  // dispararse varias veces seguidas mientras el batch se aplica.
  const extendingRef = useRef(false);

  useEffect(() => {
    const unsub = usePlayerStore.subscribe((state) => {
      if (!state.radioMode) return;
      if (extendingRef.current) return;
      const remaining = state.queue.length - state.index - 1;
      if (remaining > REMAINING_THRESHOLD) return;

      const seed = state.currentTrack;
      if (!seed) return;

      extendingRef.current = true;
      try {
        // Excluye tracks ya en la cola actual para evitar repeticiones
        // visibles consecutivas (la cola completa, no solo el resto).
        const excludeIds = new Set(state.queue.map((t) => t.id));
        const batch = buildRadioBatch({
          seedTrack: { ...seed, artist: state.radioSeedArtist ?? seed.artist },
          batchSize: BATCH_SIZE,
          excludeIds,
        });
        if (batch.length > 0) {
          usePlayerStore.getState().appendQueue(batch);
        }
      } catch (err) {
        console.warn('[radio] extend failed', err);
      } finally {
        // Pequeno cooldown — sin esto, podria re-dispararse antes de que
        // el state nuevo se propague.
        setTimeout(() => { extendingRef.current = false; }, 200);
      }
    });
    return () => unsub();
  }, []);
}
