/**
 * useJamSync — bridge entre useJamStore y usePlayerStore (Fase 8.3).
 *
 * Si mode='hosting':
 *   - Cuando el currentTrack / isPlaying / positionSeconds cambian en
 *     el player local, broadcasted al jam_sessions row.
 *   - Otros participantes lo reciben via Realtime y aplican el cambio.
 *
 * Si mode='guest':
 *   - Cuando el state del jam store cambia (vino del host por Realtime),
 *     aplicamos al player local (playNow + seek).
 *   - Bloqueamos los controles locales (el guest no controla; solo el
 *     host).
 *
 * Throttle del broadcast de posicion:
 *   El positionSeconds se actualiza ~30Hz en el player. No queremos
 *   spam de UPDATEs a Postgres. Broadcasteamos solo cada 5s + al cambio
 *   de track + al pause/play.
 *
 * @module @ritmiq/ui/lib/use-jam-sync
 */
import { useEffect, useRef } from 'react';
import { useJamStore } from '../stores/jam.js';
import { usePlayerStore } from '../stores/player.js';

const POSITION_BROADCAST_INTERVAL_MS = 5000;

// Umbrales de correccion de drift en el guest (Fase 8 / Bloque 3.1).
//   - drift >= HARD: seek duro (salto audible, pero inevitable).
//   - SOFT <= drift < HARD: compensacion con playbackRate (inaudible).
//   - drift < SOFT: nada (ya alineado), resetear rate a 1.
const DRIFT_HARD_SECONDS = 1.5;
const DRIFT_SOFT_SECONDS = 0.5;
// Rate de compensacion suave: 2% mas rapido/lento hasta alinear.
const RATE_CATCH_UP = 1.02;
const RATE_SLOW_DOWN = 0.98;

function dispatchSeek(seconds) {
  window.dispatchEvent(new CustomEvent('ritmiq:seek', { detail: { seconds } }));
}
function dispatchRate(rate) {
  window.dispatchEvent(new CustomEvent('ritmiq:set-rate', { detail: { rate } }));
}

/**
 * Hook que mantiene sincronizados el player local y el jam state.
 * Montar en App.jsx una sola vez (igual que useApplyAudioSettings).
 */
export function useJamSync() {
  const mode = useJamStore((s) => s.mode);
  const hostBroadcast = useJamStore((s) => s.hostBroadcast);
  const jamState = useJamStore((s) => s.state);

  // Refs para evitar re-disparar effects por cambios de funcion identity.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const lastBroadcastPosRef = useRef(0);
  const lastTrackIdRef = useRef(null);
  // Rate actualmente aplicado por el guest (para no re-disparar el evento).
  const guestRateRef = useRef(1);

  // ── HOSTING: subscribe a cambios del player local y broadcast ─────
  useEffect(() => {
    if (mode !== 'hosting') return undefined;

    // Subscribe granular: track cambia → broadcast inmediato.
    const unsubTrack = usePlayerStore.subscribe(
      (s) => s.currentTrack?.id,
      (id) => {
        if (modeRef.current !== 'hosting') return;
        const track = usePlayerStore.getState().currentTrack;
        if (!track) return;
        if (lastTrackIdRef.current === id) return;
        lastTrackIdRef.current = id;
        hostBroadcast({
          currentTrack: track,
          positionSeconds: 0,
          isPlaying: usePlayerStore.getState().isPlaying,
        });
      },
    );

    const unsubPlay = usePlayerStore.subscribe(
      (s) => s.isPlaying,
      (isPlaying) => {
        if (modeRef.current !== 'hosting') return;
        hostBroadcast({
          isPlaying,
          positionSeconds: usePlayerStore.getState().positionSeconds,
        });
      },
    );

    // Position broadcast con throttle 5s.
    const posInterval = setInterval(() => {
      if (modeRef.current !== 'hosting') return;
      const { currentTrack, positionSeconds, isPlaying } = usePlayerStore.getState();
      if (!currentTrack || !isPlaying) return;
      if (Math.abs(positionSeconds - lastBroadcastPosRef.current) < 1) return;
      lastBroadcastPosRef.current = positionSeconds;
      hostBroadcast({ positionSeconds });
    }, POSITION_BROADCAST_INTERVAL_MS);

    return () => {
      unsubTrack();
      unsubPlay();
      clearInterval(posInterval);
    };
  }, [mode, hostBroadcast]);

  // ── GUEST: aplica jam state al player local ─────────────────────────
  useEffect(() => {
    if (mode !== 'guest') return undefined;

    const { currentTrack, positionSeconds, isPlaying } = jamState;
    if (!currentTrack) return;

    const player = usePlayerStore.getState();

    // Si el track cambia, hacemos playNow + jump al positionSeconds.
    const sameTrack = player.currentTrack?.ytId === currentTrack.ytId
      && player.currentTrack?.id === currentTrack.id;

    if (!sameTrack) {
      player.playNow([currentTrack], 0);
      // Reset de rate: el track nuevo arranca a velocidad normal.
      if (guestRateRef.current !== 1) {
        guestRateRef.current = 1;
        dispatchRate(1);
      }
      // Pequeno delay para que el track cargue antes del seek.
      setTimeout(() => {
        if (positionSeconds > 0) dispatchSeek(positionSeconds);
        if (!isPlaying) usePlayerStore.setState({ isPlaying: false });
      }, 250);
      return;
    }

    // Mismo track: correccion de drift en tres niveles.
    const drift = player.positionSeconds - positionSeconds; // <0: guest atrasado
    const absDrift = Math.abs(drift);

    if (absDrift >= DRIFT_HARD_SECONDS) {
      // Drift grande: seek duro (audible pero necesario). Reset rate.
      dispatchSeek(positionSeconds);
      if (guestRateRef.current !== 1) {
        guestRateRef.current = 1;
        dispatchRate(1);
      }
    } else if (absDrift >= DRIFT_SOFT_SECONDS) {
      // Drift mediano: compensar con playbackRate (inaudible).
      // Si el guest esta atrasado (drift<0) acelera; si adelantado, frena.
      const targetRate = drift < 0 ? RATE_CATCH_UP : RATE_SLOW_DOWN;
      if (guestRateRef.current !== targetRate) {
        guestRateRef.current = targetRate;
        dispatchRate(targetRate);
      }
    } else if (guestRateRef.current !== 1) {
      // Ya alineado: volver a velocidad normal.
      guestRateRef.current = 1;
      dispatchRate(1);
    }

    // Corregir play/pause si difiere.
    if (player.isPlaying !== isPlaying) {
      usePlayerStore.setState({ isPlaying });
    }
  }, [mode, jamState]);
}
