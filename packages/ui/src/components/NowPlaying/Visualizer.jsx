/**
 * Visualizer \u2014 canvas de barras espectrales para NowPlaying.
 *
 * Lee getByteFrequencyData() del AnalyserNode existente (compartido con
 * useBpmPulse) y dibuja N barras verticales con altura proporcional al
 * volumen de cada bin agrupado.
 *
 * Performance:
 *   - 1 requestAnimationFrame mientras enabled=true y isPlaying.
 *   - getByteFrequencyData escribe en buffer Uint8Array pre-allocado.
 *   - drawingContext clear + N fillRect, sin gradient por frame.
 *   - 60Hz objetivo; el browser lo throttea solo si la ventana esta
 *     oculta (cero CPU en background, bien por bateria).
 *   - Off por defecto (battery friendly). Toggle en el caller.
 *
 * Estetica:
 *   - 48 barras logaritmicamente espaciadas (bajo \u2192 alto).
 *   - Gradient accent vertical (CSS via canvas gradient en setup).
 *   - Smoothing exponencial 0.5 para que las barras decaigan suaves
 *     en lugar de saltar entre frames.
 *
 * @module @ritmiq/ui/components/NowPlaying/Visualizer
 */
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../../stores/player.js';
import { getSharedBackend } from '../../lib/use-player.js';
import styles from './Visualizer.module.css';

const NUM_BARS = 48;
const FFT_SIZE = 512;
const SMOOTH = 0.5;

/**
 * Calcula los indices de bins que cada barra agrupa, distribuidos
 * logaritmicamente. Asi las barras agudas no se ven aplastadas.
 */
function buildBarBuckets(numBins) {
  const buckets = [];
  const minIdx = 1;          // skip DC bin
  const maxIdx = numBins - 1;
  for (let i = 0; i < NUM_BARS; i++) {
    const t0 = i / NUM_BARS;
    const t1 = (i + 1) / NUM_BARS;
    // Espaciado logaritmico: log2 scale.
    const from = Math.floor(minIdx * Math.pow(maxIdx / minIdx, t0));
    const to   = Math.max(from + 1, Math.floor(minIdx * Math.pow(maxIdx / minIdx, t1)));
    buckets.push({ from, to });
  }
  return buckets;
}

export function Visualizer({ enabled }) {
  const canvasRef = useRef(null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    if (!enabled) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const backend = getSharedBackend?.();
    if (!backend?.getAnalyser) return undefined;

    let analyser;
    try {
      analyser = backend.getAnalyser();
      if (!analyser) return undefined;
      analyser.fftSize = FFT_SIZE;
    } catch {
      return undefined;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    // HiDPI scale.
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    // Gradient accent vertical (creado una vez, reutilizado por frame).
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    // Tomamos --color-accent del documento. Como CSS vars no son
    // directamente accesibles, leemos via getComputedStyle.
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent').trim() || '#7c5cff';
    grad.addColorStop(0, accent);
    grad.addColorStop(1, accent + '40'); // 25% alpha al fondo

    const bins = new Uint8Array(analyser.frequencyBinCount);
    const buckets = buildBarBuckets(analyser.frequencyBinCount);
    const smoothed = new Float32Array(NUM_BARS);

    let rafId = 0;
    const tick = () => {
      analyser.getByteFrequencyData(bins);
      ctx.clearRect(0, 0, W, H);

      const barWidth = W / NUM_BARS;
      const innerW = Math.max(1, barWidth * 0.62);
      const gap = barWidth - innerW;

      ctx.fillStyle = grad;
      for (let i = 0; i < NUM_BARS; i++) {
        const { from, to } = buckets[i];
        let sum = 0;
        for (let b = from; b < to; b++) sum += bins[b];
        const avg = sum / Math.max(1, to - from); // 0..255
        const norm = avg / 255;
        smoothed[i] = smoothed[i] * SMOOTH + norm * (1 - SMOOTH);
        const h = smoothed[i] * H;
        const x = i * barWidth + gap / 2;
        const y = H - h;
        // Barra con esquinas redondeadas si soportado.
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(x, y, innerW, h, [2, 2, 0, 0]);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, innerW, h);
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    if (isPlaying) {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [enabled, isPlaying]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      aria-hidden="true"
    />
  );
}
