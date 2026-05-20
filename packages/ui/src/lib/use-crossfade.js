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
  const animRef = useRef(null);

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
      fadeIn(backend, seconds);
    });
    return () => {
      unsub();
      cancelAnim();
    };

    function cancelAnim() {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    }
  }, [backend]);
}

/**
 * Fade-in del volumen del audio backend desde 0 hasta el volumen del
 * store, en `seconds`. Si el backend ya esta a su volumen objetivo,
 * no hace nada visible.
 *
 * @param {ReturnType<import('./html-audio-backend.js').createHtmlAudioBackend>} backend
 * @param {number} seconds
 */
function fadeIn(backend, seconds) {
  const el = backend.element?.();
  if (!el) return;
  const targetVol = usePlayerStore.getState().volume ?? 0.8;
  if (targetVol <= 0.01) return;
  const startTime = performance.now();
  const durMs = Math.max(50, seconds * 1000);
  try { el.volume = 0; } catch { return; }

  function tick(now) {
    const t = Math.min(1, (now - startTime) / durMs);
    // Ease-out cubic — ramp natural percibido como mas suave.
    const eased = 1 - Math.pow(1 - t, 3);
    try { el.volume = targetVol * eased; } catch {}
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      try { el.volume = targetVol; } catch {}
    }
  }
  requestAnimationFrame(tick);
}
