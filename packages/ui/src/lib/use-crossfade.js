/**
 * Crossfade simple basado en el `audio.volume` del HTMLMediaElement.
 *
 * NOTA: NO es crossfade real (dos audios solapados). Es un fade-out al
 * cambiar de track manualmente: cuando el usuario pulsa next/prev y el
 * audio actual esta sonando, hacemos un fade-out rapido (X segundos
 * configurable) antes del swap. El track nuevo arranca con fade-in
 * inmediato hasta el volumen del store.
 *
 * Justificacion: el crossfade real con solapamiento requeriria dual
 * <audio> elements + WebAudio graph + reescritura del flow de
 * use-player.js. El flow actual es delicado por iOS background playback;
 * un fade-out simple aporta el 80% del UX sin tocar lo que funciona.
 *
 * Si el setting crossfadeSeconds === 0 → el hook es no-op.
 *
 * @module @ritmiq/ui/lib/use-crossfade
 */
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../stores/player.js';
import { useSettingsStore } from '../stores/settings.js';

/**
 * @param {ReturnType<import('./html-audio-backend.js').createHtmlAudioBackend>} backend
 */
export function useCrossfade(backend) {
  const lastTrackIdRef = useRef(null);
  /** @type {React.MutableRefObject<ReturnType<typeof setInterval>|null>} */
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!backend) return;
    const unsub = usePlayerStore.subscribe((state, prev) => {
      const seconds = useSettingsStore.getState().crossfadeSeconds;
      if (seconds <= 0) {
        lastTrackIdRef.current = state.currentTrack?.id ?? null;
        return;
      }
      const curId = state.currentTrack?.id;
      const prevId = lastTrackIdRef.current;
      if (curId === prevId) return;
      lastTrackIdRef.current = curId;
      if (!curId) return;

      // El swap del backend ya ocurrio (state ya tiene el currentTrack
      // nuevo). Aqui solo hacemos fade-in del volumen sobre el elemento
      // que esta sonando ahora.
      //
      // Cancela cualquier fade en curso para evitar dos intervals
      // pisandose el volumen del mismo <audio>.
      cancelFade();
      intervalRef.current = fadeIn(backend, seconds);
    });
    return () => {
      unsub();
      cancelFade();
    };

    function cancelFade() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [backend]);
}

/**
 * Fade-in del volumen del audio backend desde 0 hasta el volumen del
 * store, en `seconds`. Si el backend ya esta a su volumen objetivo,
 * no hace nada visible.
 *
 * CRITICO desktop background: usamos setInterval, NO requestAnimationFrame.
 *
 * Bug previo: con la ventana Electron minimizada y crossfadeSeconds > 0,
 * el track auto-next sonaba EN SILENCIO hasta abrir la ventana de nuevo.
 *
 * Causa raiz: rAF esta atado al ciclo de composicion/vsync de la ventana.
 * Cuando la ventana se minimiza (o queda totalmente ocluida), Chromium
 * pausa el compositor de esa ventana y los rAF encolados NO se ejecutan.
 * El flag `webPreferences.backgroundThrottling: false` (ver
 * apps/desktop/main/index.js) NO cubre este caso \u2014 ese flag solo desactiva
 * el throttling de TIMERS (setTimeout/setInterval), no del compositor.
 *
 * Sintoma exacto:
 *   1. fadeIn() seteaba el.volume = 0 sincronicamente.
 *   2. rAF(tick) quedaba encolado pero no corria \u2014 ventana minimizada.
 *   3. <audio> seguia avanzando (timeupdate dispara) pero con volume=0
 *      \u2192 reproduccion en silencio total.
 *   4. Usuario abria la ventana \u2192 rAF se reanudaba \u2192 tick completaba
 *      el fade \u2192 volvia el sonido.
 *
 * Fix: setInterval @ 30Hz. Cubierto por backgroundThrottling:false que
 * SI afecta a setInterval. El fade completa normalmente en background
 * y el volumen llega a targetVol aunque la ventana este minimizada.
 *
 * El listener anterior del AudioContext (commit 0bf1ec4) era una
 * hipotesis errada \u2014 el ctx ni siquiera se crea si el usuario no
 * activa EQ o no abre NowPlaying con useBpmPulse. Los cambios de
 * aquel commit son defensivos pero NO arreglaban este bug.
 *
 * @param {ReturnType<import('./html-audio-backend.js').createHtmlAudioBackend>} backend
 * @param {number} seconds
 * @returns {ReturnType<typeof setInterval>|null} id del interval o null si no hubo fade
 */
function fadeIn(backend, seconds) {
  const el = backend.element?.();
  if (!el) return null;
  const targetVol = usePlayerStore.getState().volume ?? 0.8;
  if (targetVol <= 0.01) return null;
  const startTime = performance.now();
  const durMs = Math.max(50, seconds * 1000);
  try { el.volume = 0; } catch { return null; }

  // 33ms = ~30Hz. Suficiente para que el oido perciba el fade suave
  // (umbral de perceptibilidad ~50ms), y no satura CPU en background.
  const id = setInterval(() => {
    const t = Math.min(1, (performance.now() - startTime) / durMs);
    // Ease-out cubic \u2014 ramp natural percibido como mas suave.
    const eased = 1 - Math.pow(1 - t, 3);
    try { el.volume = targetVol * eased; } catch {}
    if (t >= 1) {
      try { el.volume = targetVol; } catch {}
      clearInterval(id);
    }
  }, 33);
  return id;
}
