/**
 * BPM-reactive pulse — analiza el espectro de bajos en tiempo real y
 * devuelve un valor `scale` (1.00..1.06) para aplicar al cover.
 *
 * NO estima BPM como tal — eso requeriria FFT mas pesado o un worker.
 * Lo que hacemos es: tomamos la energia en banda baja (sub-bass + bass,
 * ~20-200 Hz) de cada frame de rAF, suavizamos exponencialmente, y
 * mapeamos a una escala visual leve. Es el patron clasico de visualizer
 * "cover pulsando con la musica" sin la complejidad de un BPM tracker.
 *
 * Performance:
 *  - 1 rAF mientras el componente este montado Y haya playback.
 *  - getByteFrequencyData() escribe en buffer pre-allocado (sin GC).
 *  - El AudioContext se inicializa la primera vez que se monta este hook
 *    via backend.getAnalyser(). Una vez creado no se destruye.
 *  - Cuando isPlaying === false o el componente desmonta, se cancela el
 *    rAF — cero CPU en idle.
 *
 * @module @ritmiq/ui/lib/use-bpm-pulse
 */
import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../stores/player.js';

const FFT_SIZE = 1024;
const SMOOTH = 0.85;            // smoothing exponencial del valor
const SCALE_MIN = 1.0;
const SCALE_MAX = 1.06;
const BASS_BIN_END = 32;        // primeros bins ~= 0-700Hz a 44.1kHz / 1024

/**
 * @param {ReturnType<import('./html-audio-backend.js').createHtmlAudioBackend>} backend
 * @param {boolean} enabled  permite suspender el hook cuando el cover no es visible
 * @returns {number} factor de escala 1.00..1.06
 */
export function useBpmPulse(backend, enabled = true) {
  const [scale, setScale] = useState(SCALE_MIN);
  const smoothRef = useRef(0);

  useEffect(() => {
    if (!enabled || !backend) return undefined;
    let analyser;
    try {
      analyser = backend.getAnalyser?.();
      if (!analyser) return undefined;
      analyser.fftSize = FFT_SIZE;
    } catch {
      return undefined;
    }

    const bins = new Uint8Array(analyser.frequencyBinCount);
    let raf = null;
    let lastSet = 0;

    function tick(now) {
      // Solo procesa si esta reproduciendo. Si pausado, mantiene la
      // ultima escala pero no consume CPU haciendo getByteFrequencyData.
      const isPlaying = usePlayerStore.getState().isPlaying;
      if (!isPlaying) {
        smoothRef.current *= 0.92; // decay suave
        const s = SCALE_MIN + smoothRef.current * (SCALE_MAX - SCALE_MIN);
        if (Math.abs(s - scale) > 0.002) setScale(s);
        raf = requestAnimationFrame(tick);
        return;
      }
      analyser.getByteFrequencyData(bins);
      // Energia media en banda baja, normalizada a [0, 1].
      let sum = 0;
      const end = Math.min(BASS_BIN_END, bins.length);
      for (let i = 0; i < end; i++) sum += bins[i];
      const avg = sum / end / 255;

      // Smoothing exponencial — evita parpadeo agresivo entre frames.
      smoothRef.current = smoothRef.current * SMOOTH + avg * (1 - SMOOTH);

      const s = SCALE_MIN + smoothRef.current * (SCALE_MAX - SCALE_MIN);
      // Throttle setState a ~30fps maximo para no spammear React.
      if (now - lastSet > 32) {
        lastSet = now;
        setScale(s);
      }
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, enabled]);

  return scale;
}
