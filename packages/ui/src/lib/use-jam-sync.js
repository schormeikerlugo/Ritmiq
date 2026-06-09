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
import { toast } from '../stores/toast.js';

export function useJamSync() {
  const mode = useJamStore((s) => s.mode);
  const jamState = useJamStore((s) => s.state);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const jamStateRef = useRef(jamState);
  jamStateRef.current = jamState;
  const lastBlockToastRef = useRef(0);

  // ── HOST: orquestar la reproduccion coordinada ────────────────────────
  useEffect(() => {
    if (mode !== 'hosting') return undefined;

    // CAMBIO DE TRACK del host por CUALQUIER via (biblioteca, busqueda,
    // playSuggestion ya marca el jamState antes, etc.). Si el track que
    // suena localmente NO coincide con el del jam (jamState.currentTrack),
    // significa que el host eligio algo nuevo → iniciar arranque coordinado
    // para que TODOS lo reproduzcan. Sin esto, el host sonaba solo y el
    // guest no se enteraba.
    const unsubTrack = usePlayerStore.subscribe(
      (s) => s.currentTrack?.ytId || s.currentTrack?.id || null,
      () => {
        if (modeRef.current !== 'hosting') return;
        const cur = usePlayerStore.getState().currentTrack;
        if (!cur) return;
        const jamTrack = useJamStore.getState().state?.currentTrack;
        const same = jamTrack
          && (jamTrack.ytId === cur.ytId)
          && (jamTrack.id === cur.id);
        if (same) return; // ya es el track coordinado actual
        // Disparar arranque coordinado con el track elegido por el host.
        useJamStore.getState().coordinatedPlay(cur);
      },
    );

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
      unsubTrack();
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
        const cur = usePlayerStore.getState().currentTrack;
        const same = hostTrack
          && cur?.ytId === hostTrack.ytId && cur?.id === hostTrack.id;
        if (same) return;
        // El guest intento reproducir otra cosa (clic en lista, etc.). En una
        // jam NO puede controlar la reproduccion: revertimos al track del host
        // y DETENEMOS el audio que acaba de arrancar. Avisamos por toast
        // (throttled para no spamear si hay varios cambios seguidos).
        const now = Date.now();
        if (now - lastBlockToastRef.current > 2500) {
          lastBlockToastRef.current = now;
          toast.info('El host controla la reproducción. Usa “Sugerir a la jam”.');
        }
        usePlayerStore.setState({
          currentTrack: hostTrack ?? null,
          isPlaying: false,
        });
      },
    );

    return () => { unsubPlay(); unsubTrack(); };
  }, [mode]);
}
