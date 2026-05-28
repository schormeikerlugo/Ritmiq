/**
 * EqCurve \u2014 visualizacion SVG de la curva de respuesta del EQ.
 *
 * Dibuja la magnitud de respuesta combinada de las 6 bandas como una
 * curva continua sobre escala logaritmica de frecuencia (20 Hz a 20 kHz).
 * Usa una aproximacion simple gaussiana por banda y la suma de
 * contribuciones \u2014 NO calcula la respuesta exacta de BiquadFilter
 * Web Audio (eso requeriria getFrequencyResponse de cada nodo, un
 * AudioContext activo, y mas trabajo del que aporta).
 *
 * La aproximacion es suficiente para:
 *   - Confirmar visualmente que el preset cambia la forma.
 *   - Ver de un vistazo si la curva es plana, V, U, etc.
 *   - Reaccionar a los sliders en tiempo real.
 *
 * Render:
 *   - Eje X: log(freq) desde 20Hz a 20kHz.
 *   - Eje Y: dB de -12 a +12 (clamp al rango de los sliders).
 *   - Linea con gradient accent.
 *   - Linea horizontal punteada en 0 dB.
 *   - Dots en los puntos de banda (con valor de gain encima).
 *
 * @module @ritmiq/ui/components/SettingsView/sections/EqCurve
 */
import { useMemo } from 'react';
import { EQ_BANDS } from '../../../lib/html-audio-backend.js';
import styles from './EqCurve.module.css';

const WIDTH = 320;
const HEIGHT = 80;
const PAD_X = 8;
const PAD_Y = 8;
const DB_MIN = -12;
const DB_MAX = 12;
const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const SAMPLES = 80; // puntos de la curva renderizada

function freqToX(f) {
  const lf = Math.log10(f);
  const lfMin = Math.log10(FREQ_MIN);
  const lfMax = Math.log10(FREQ_MAX);
  return PAD_X + ((lf - lfMin) / (lfMax - lfMin)) * (WIDTH - 2 * PAD_X);
}

function gainToY(g) {
  const norm = (g - DB_MIN) / (DB_MAX - DB_MIN);
  return PAD_Y + (1 - norm) * (HEIGHT - 2 * PAD_Y);
}

/**
 * Contribucion de una banda peaking a la frecuencia f. Aproximacion
 * gaussiana en el dominio log-freq con desviacion derivada del Q.
 */
function bandResponse(band, gain, f) {
  if (gain === 0) return 0;
  const lf = Math.log10(f);
  const lfc = Math.log10(band.freq);
  // Ancho aprox: 1 octava para Q=1.0. Convertir a log10 = log2/log10(2).
  const widthLog10 = 1 / band.q / Math.log2(10);
  const dist = (lf - lfc) / widthLog10;

  if (band.type === 'lowshelf') {
    // Lowshelf: full gain debajo de freq, sube/baja con suavidad.
    // Aproximacion sigmoide centrada en band.freq.
    return gain / (1 + Math.exp(4 * dist));
  }
  if (band.type === 'highshelf') {
    return gain / (1 + Math.exp(-4 * dist));
  }
  // peaking: gaussiana centrada en band.freq.
  return gain * Math.exp(-dist * dist);
}

function computeCurvePoints(gains) {
  const points = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    const lf = Math.log10(FREQ_MIN) + t * (Math.log10(FREQ_MAX) - Math.log10(FREQ_MIN));
    const f = Math.pow(10, lf);
    let total = 0;
    for (let b = 0; b < EQ_BANDS.length; b++) {
      total += bandResponse(EQ_BANDS[b], gains[b] ?? 0, f);
    }
    // Clamp al rango de los sliders \u2014 valores extremos saturados.
    const clamped = Math.max(DB_MIN, Math.min(DB_MAX, total));
    points.push([freqToX(f), gainToY(clamped)]);
  }
  return points;
}

function pointsToPath(points) {
  if (points.length === 0) return '';
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`;
  }
  return d;
}

export function EqCurve({ gains }) {
  const safeGains = useMemo(
    () => Array.isArray(gains) && gains.length === EQ_BANDS.length
      ? gains
      : EQ_BANDS.map(() => 0),
    [gains],
  );

  const curveD = useMemo(() => pointsToPath(computeCurvePoints(safeGains)), [safeGains]);

  // Path del area rellena debajo de la curva: cierra al baseline 0 dB.
  const baselineY = gainToY(0);
  const fillD = useMemo(() => {
    const pts = computeCurvePoints(safeGains);
    if (pts.length === 0) return '';
    let d = `M ${pts[0][0].toFixed(2)} ${baselineY.toFixed(2)}`;
    for (const [x, y] of pts) d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    d += ` L ${pts[pts.length - 1][0].toFixed(2)} ${baselineY.toFixed(2)} Z`;
    return d;
  }, [safeGains, baselineY]);

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ritmiq-eqcurve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Baseline 0 dB punteada. */}
      <line
        x1={PAD_X} y1={baselineY}
        x2={WIDTH - PAD_X} y2={baselineY}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="1"
        strokeDasharray="3 4"
      />

      {/* Fill debajo de la curva. */}
      <path d={fillD} fill="url(#ritmiq-eqcurve-fill)" />

      {/* Curva. */}
      <path
        d={curveD}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Dots en cada banda. */}
      {EQ_BANDS.map((band, i) => {
        const g = safeGains[i] ?? 0;
        return (
          <circle
            key={band.freq}
            cx={freqToX(band.freq)}
            cy={gainToY(Math.max(DB_MIN, Math.min(DB_MAX, g)))}
            r="3"
            fill="var(--color-accent)"
          />
        );
      })}
    </svg>
  );
}
