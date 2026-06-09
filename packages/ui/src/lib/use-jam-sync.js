/**
 * useJamSync — bridge entre useJamStore y usePlayerStore (Bloque 3.7).
 *
 * MODELO: arranque coordinado por broadcast (no perseguir el reloj del host).
 *   - El cambio de cancion lo orquesta el store (coordinatedPlay/jamAdvance):
 *     prepare → ready → start. El player obedece via eventos
 *     'ritmiq:jam-prepare'/'ritmiq:jam-start'. Aqui NO hacemos seeks de drift
 *     ni playbackRate (eso ralentizaba la cancion). Todos arrancan desde 0 a
 *     la vez, asi que la deriva es minima.
 *
 *   - HOST: cuando el usuario pausa/reanuda/seekea localmente, propagamos ese
 *     control a los guests por broadcast ('control'). El cambio de track ya
 *     va por el handshake coordinado, no aqui.
 *
 *   - GUEST: enforcement read-only. El guest no controla la reproduccion:
 *     revertimos al instante cualquier isPlaying/currentTrack que no venga del
 *     host. Cubre MediaSession (lockscreen/auriculares), teclado y clics.
 *
 * Montar en App.jsx una sola vez (igual que useApplyAudioSettings).
 *
 * @module @ritmiq/ui/lib/use-jam-sync
 */
import { useEffect, useRef } from 'react';
import { useJamStore } from '../stores/jam.js';
import { usePlayerStore } from '../stores/player.js';

export function useJamSync() {
  const mode = useJamStore((s) => s.mode);
  const jamState = useJamStore((s) => s.state);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const jamStateRef = useRef(jamState);
  jamStateRef.current = jamState;

  // ── HOST: propagar play/pause/seek local a los guests (broadcast) ──────
  useEffect(() => {
    if (mode !== 'hosting') return undefined;

    // Play/pause: el host pulsa el boton → control a los guests.
    const unsubPlay = usePlayerStore.subscribe(
      (s) => s.isPlaying,
      (isPlaying) => {
        if (modeRef.current !== 'hosting') return;
        useJamStore.getState()._broadcast('control', {
          action: isPlaying ? 'play' : 'pause',
        });
      },
    );

    // Seek: el host mueve la barra → emite evento que tambien escuchamos
    // aqui para reenviarlo como control 'seek' a los guests.
    const onLocalSeek = (ev) => {
      if (modeRef.current !== 'hosting') return;
      const seconds = ev?.detail?.seconds;
      if (typeof seconds === 'number') {
        useJamStore.getState()._broadcast('control', { action: 'seek', seconds });
      }
    };
    window.addEventListener('ritmiq:seek', onLocalSeek);

    return () => {
      unsubPlay();
      window.removeEventListener('ritmiq:seek', onLocalSeek);
    };
  }, [mode]);

  // ── GUEST: enforcement read-only ──────────────────────────────────────
  // Revertir al instante cualquier control local que no venga del host.
  useEffect(() => {
    if (mode !== 'guest') return undefined;

    const unsubPlay = usePlayerStore.subscribe(
      (s) => s.isPlaying,
      (isPlaying) => {
        if (modeRef.current !== 'guest') return;
        const want = jamStateRef.current?.isPlaying;
        if (want != null && isPlaying !== want) {
          usePlayerStore.setState({ isPlaying: want });
        }
      },
    );

    const unsubTrack = usePlayerStore.subscribe(
      (s) => s.currentTrack?.ytId || s.currentTrack?.id || null,
      () => {
        if (modeRef.current !== 'guest') return;
        const hostTrack = jamStateRef.current?.currentTrack;
        if (!hostTrack) return;
        const cur = usePlayerStore.getState().currentTrack;
        const same = cur?.ytId === hostTrack.ytId && cur?.id === hostTrack.id;
        if (!same) {
          // Reaplicar la cancion del host (sin reproducir; el handshake manda).
          usePlayerStore.setState({ currentTrack: hostTrack });
        }
      },
    );

    return () => { unsubPlay(); unsubTrack(); };
  }, [mode]);
}
