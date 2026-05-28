/**
 * Visualizer \u2014 canvas de barras espectrales para NowPlaying.
 *
 * Lee getByteFrequencyData() del AnalyserNode existente (compartido con
 * useBpmPulse) y dibuja N barras verticales con altura proporcional al
 * volumen de cada bin agrupado.
 *
 * Robustez (FIX.2):
 *   - Si el WebAudio graph aun no esta listo cuando se monta, polling
 *     cada 1s hasta 10 veces para reintentar attach. Sin esto el canvas
 *     quedaba transparente para siempre si el usuario activaba el
 *     visualizer antes del primer init del graph.
 *   - ResizeObserver del canvas: si las dimensiones cambian (cambio de
 *     vista, rotacion, etc), reinit del HiDPI scale + gradient.
 *   - Cuando isPlaying=false, mantiene el rAF y aplica decay suave a
 *     las barras en lugar de cortar bruscamente. Asi el usuario ve la
 *     transicion play\u2192pause y confirma visualmente que el visualizer
 *     esta vivo.
 *   - Modo "demo" cuando enabled pero graph no disponible: dibuja
 *     barras sintéticas con sin() para que el usuario VEA algo y sepa
 *     que el toggle funciono. Se sustituye automaticamente por audio
 *     real cuando el graph aparece.
 *
 * Performance:
 *   - 1 requestAnimationFrame mientras enabled=true.
 *   - getByteFrequencyData escribe en buffer Uint8Array pre-allocado.
 *   - drawingContext clear + N fillRect, sin gradient por frame.
 *   - 60Hz objetivo; el browser lo throttea solo si la ventana esta
 *     oculta (cero CPU en background, bien por bateria).
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
const PAUSE_DECAY = 0.92;
const ATTACH_INTERVAL_MS = 1000;
const MAX_ATTACH_ATTEMPTS = 10;

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
    const from = Math.floor(minIdx * Math.pow(maxIdx / minIdx, t0));
    const to   = Math.max(from + 1, Math.floor(minIdx * Math.pow(maxIdx / minIdx, t1)));
    buckets.push({ from, to });
  }
  return buckets;
}

export function Visualizer({ enabled }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    // ── Estado mutable del setup ────────────────────────────────────────
    let analyser = null;
    let bins = null;
    let buckets = null;
    const smoothed = new Float32Array(NUM_BARS);
    let W = 0, H = 0;
    let grad = null;
    let rafId = 0;
    let attachAttempts = 0;
    let attachTimer = null;
    // Tiempo inicial para el fallback demo (sintetiza barras sin audio).
    const startTs = performance.now();

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      // Si el canvas no esta visible (display:none o tamano 0) salimos
      // sin tocar nada \u2014 ResizeObserver nos llamara cuando aparezca.
      if (rect.width === 0 || rect.height === 0) return;
      W = rect.width;
      H = rect.height;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      // Gradient accent vertical (recreado en cada resize porque depende
      // de H). Leemos --color-accent del documento.
      const accent = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-accent').trim() || '#7c5cff';
      grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, accent + '40'); // 25% alpha al fondo
    }

    function tryAttachAnalyser() {
      const backend = getSharedBackend?.();
      if (backend?.getAnalyser) {
        try {
          const a = backend.getAnalyser();
          if (a) {
            a.fftSize = FFT_SIZE;
            analyser = a;
            bins = new Uint8Array(analyser.frequencyBinCount);
            buckets = buildBarBuckets(analyser.frequencyBinCount);
            return true;
          }
        } catch {}
      }
      attachAttempts++;
      if (attachAttempts < MAX_ATTACH_ATTEMPTS) {
        attachTimer = setTimeout(tryAttachAnalyser, ATTACH_INTERVAL_MS);
      }
      return false;
    }

    function drawBars(values) {
      ctx.clearRect(0, 0, W, H);
      if (!grad) return;
      ctx.fillStyle = grad;
      const barWidth = W / NUM_BARS;
      const innerW = Math.max(1, barWidth * 0.62);
      const gap = barWidth - innerW;
      for (let i = 0; i < NUM_BARS; i++) {
        const h = Math.max(2, values[i] * H);
        const x = i * barWidth + gap / 2;
        const y = H - h;
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(x, y, innerW, h, [2, 2, 0, 0]);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, innerW, h);
        }
      }
    }

    function tick(now) {
      if (W === 0 || H === 0) {
        // Canvas no medido todavia \u2014 reintentamos pronto.
        rafId = requestAnimationFrame(tick);
        return;
      }

      const isPlaying = usePlayerStore.getState().isPlaying;

      if (analyser && bins && buckets) {
        // ── Modo real: leer audio del analyser ──────────────────────
        if (isPlaying) {
          analyser.getByteFrequencyData(bins);
          for (let i = 0; i < NUM_BARS; i++) {
            const { from, to } = buckets[i];
            let sum = 0;
            for (let b = from; b < to; b++) sum += bins[b];
            const avg = sum / Math.max(1, to - from); // 0..255
            const norm = avg / 255;
            smoothed[i] = smoothed[i] * SMOOTH + norm * (1 - SMOOTH);
          }
        } else {
          // Pausado: decay hacia 0 conservando ultima forma.
          for (let i = 0; i < NUM_BARS; i++) smoothed[i] *= PAUSE_DECAY;
        }
      } else {
        // ── Modo demo (graph no disponible): barras sintéticas ───────
        // Sirve como puerta trasera visual: el usuario ve algo aunque
        // el WebAudio graph no se inicialice. Sera reemplazado por audio
        // real cuando tryAttachAnalyser conecte.
        const t = (now - startTs) / 1000;
        for (let i = 0; i < NUM_BARS; i++) {
          const base = 0.18 + 0.12 * Math.sin(t * 1.5 + i * 0.35);
          // Reducido cuando esta pausado \u2014 mismo feedback intuitivo.
          const target = isPlaying ? base : base * 0.35;
          smoothed[i] = smoothed[i] * 0.85 + target * 0.15;
        }
      }

      drawBars(smoothed);
      rafId = requestAnimationFrame(tick);
    }

    // ── Setup inicial ───────────────────────────────────────────────────
    resizeCanvas();
    tryAttachAnalyser();
    rafId = requestAnimationFrame(tick);

    // ResizeObserver: si el canvas cambia de tamano (cambio de viewport,
    // rotacion mobile, abrir/cerrar paneles laterales), re-inicializamos
    // las dimensiones para evitar dibujar a una resolucion stale.
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => resizeCanvas());
      ro.observe(canvas);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (attachTimer) clearTimeout(attachTimer);
      if (ro) ro.disconnect();
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      aria-hidden="true"
    />
  );
}
