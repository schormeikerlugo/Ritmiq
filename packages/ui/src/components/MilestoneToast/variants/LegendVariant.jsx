/**
 * LegendVariant — animacion 365 dias de racha.
 *
 * Identidad: epico, cosmico, irrepetible. MODAL completo con boton
 * "Continuar" — el user debe reconocer explicitamente el logro.
 *
 * Elementos visuales (5 capas):
 *   1. Backdrop blur fullscreen.
 *   2. 30 prismas/diamantes cayendo con HSL shifting.
 *   3. 12 estrellas con cola de cometa subiendo.
 *   4. 3 ondas concentricas que expanden.
 *   5. 8 rayos laser diagonales atravesando la pantalla.
 *   6. 50 dots flotando lentos en el fondo.
 *
 * Icon ring: conic-gradient girando 4s/loop.
 * Title con shine sweep. Subtitle con shake leve al aparecer.
 * Boton "Continuar" con estilo premium holografico.
 *
 * NO auto-dismiss. Solo cierra con boton o tap fuera.
 *
 * @module @ritmiq/ui/components/MilestoneToast/variants/LegendVariant
 */
import { useMemo } from 'react';
import { Icon } from '../../Icon/Icon.jsx';
import { generateParticles, particleCount, lerp, prefersReducedMotion } from '../lib/particle-helpers.js';
import styles from './LegendVariant.module.css';

// No exportamos duracion fija — es modal, no auto-dismiss.
// El orquestador lo sabe via `isModal` prop.
export const LEGEND_DURATION_MS = null;
export const LEGEND_IS_MODAL = true;

function StarComet() {
  return (
    <svg viewBox="0 0 60 14" aria-hidden="true">
      <defs>
        <linearGradient id="cometTrail" x1="0" y1="0" x2="60" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="1" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path d="M0 7 L48 7" stroke="url(#cometTrail)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path d="M48 7 L60 0 L57 7 L60 14 Z" fill="currentColor" />
    </svg>
  );
}

function Prism() {
  return (
    <svg viewBox="0 0 12 14" aria-hidden="true">
      <path d="M6 0 L12 4 L9 14 L3 14 L0 4 Z" fill="currentColor" />
    </svg>
  );
}

export function LegendVariant({ streakValue, onClose }) {
  const reduce = prefersReducedMotion();

  const prismCount = particleCount(30, 16);
  const cometCount = particleCount(12, 7);
  const waveCount = 3;
  const laserCount = particleCount(8, 5);
  const dotCount = particleCount(50, 25);

  const prisms = useMemo(() => generateParticles(prismCount, 5050), [prismCount]);
  const comets = useMemo(() => generateParticles(cometCount, 6060), [cometCount]);
  const lasers = useMemo(() => generateParticles(laserCount, 7070), [laserCount]);
  const dots = useMemo(() => generateParticles(dotCount, 8080), [dotCount]);
  const waves = useMemo(() => [0, 1, 2].slice(0, waveCount), []);

  const handleBackdropClick = (e) => {
    // Cierra solo si el click es en el backdrop, no en el toast.
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="legend-title"
    >
      {/* Capa de fondo: dots flotantes */}
      {!reduce && (
        <div className={styles.dotsLayer} aria-hidden="true">
          {dots.map((p) => {
            const x = lerp(p.r1, -50, 50);
            const y = lerp(p.r2, -50, 50);
            const size = lerp(p.r3, 1.5, 3.5);
            const dur = lerp(p.r4, 4000, 7000);
            const left = lerp(p.r1, 0, 100);
            const top = lerp(p.r2, 0, 100);
            const delay = (p.i * 53) % 2000;
            return (
              <span
                key={p.i}
                className={styles.dot}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  '--dx': `${x}px`,
                  '--dy': `${y}px`,
                  '--size': `${size}px`,
                  '--dur': `${dur}ms`,
                  '--delay': `${delay}ms`,
                  '--hue': lerp(p.r3, 180, 320),
                }}
              />
            );
          })}
        </div>
      )}

      {/* Capa: laser diagonales */}
      {!reduce && (
        <div className={styles.lasersLayer} aria-hidden="true">
          {lasers.map((p) => {
            const angle = lerp(p.r1, -35, 35);
            const top = lerp(p.r2, 10, 90);
            const dur = lerp(p.r3, 800, 1300);
            const delay = 300 + p.i * 220;
            const hue = lerp(p.r4, 180, 320);
            return (
              <span
                key={p.i}
                className={styles.laser}
                style={{
                  top: `${top}%`,
                  transform: `rotate(${angle}deg)`,
                  '--dur': `${dur}ms`,
                  '--delay': `${delay}ms`,
                  '--hue': hue,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Capa: ondas concentricas */}
      {!reduce && (
        <div className={styles.wavesLayer} aria-hidden="true">
          {waves.map((i) => (
            <span
              key={i}
              className={styles.wave}
              style={{ animationDelay: `${i * 500}ms` }}
            />
          ))}
        </div>
      )}

      <div className={styles.toast} onClick={(e) => e.stopPropagation()}>
        <div className={styles.iconWrap}>
          <span className={styles.iconRing} aria-hidden="true" />
          <span className={styles.iconCore}>
            <Icon name="Award" size={42} filled />
          </span>
        </div>

        {/* Capa: prismas cayendo (dentro del toast container para que el
            efecto se centre alrededor del modal). */}
        {!reduce && (
          <div className={styles.prismLayer} aria-hidden="true">
            {prisms.map((p) => {
              const x = lerp(p.r1, -180, 180);
              const y = lerp(p.r2, 240, 360);
              const rot = lerp(p.r3, -540, 540);
              const dur = lerp(p.r4, 2400, 3400);
              const size = lerp(p.r1, 8, 14);
              const hue = lerp(p.r2, 180, 320);
              const delay = (p.i * 50) % 800;
              return (
                <span
                  key={p.i}
                  className={styles.prism}
                  style={{
                    '--x': `${x}px`,
                    '--y': `${y}px`,
                    '--rot': `${rot}deg`,
                    '--dur': `${dur}ms`,
                    '--size': `${size}px`,
                    '--hue': hue,
                    '--delay': `${delay}ms`,
                  }}
                >
                  <Prism />
                </span>
              );
            })}
          </div>
        )}

        {/* Capa: cometas estrella */}
        {!reduce && (
          <div className={styles.cometsLayer} aria-hidden="true">
            {comets.map((p) => {
              const x = lerp(p.r1, -200, 200);
              const y = lerp(p.r2, -240, -140);
              const dur = lerp(p.r3, 1600, 2400);
              const delay = 400 + p.i * 110;
              const hue = lerp(p.r4, 200, 320);
              return (
                <span
                  key={p.i}
                  className={styles.comet}
                  style={{
                    '--x': `${x}px`,
                    '--y': `${y}px`,
                    '--dur': `${dur}ms`,
                    '--delay': `${delay}ms`,
                    color: `hsl(${hue}, 95%, 70%)`,
                  }}
                >
                  <StarComet />
                </span>
              );
            })}
          </div>
        )}

        <h2 id="legend-title" className={styles.title}>
          <span className={styles.titleText}>¡Un ano entero!</span>
        </h2>
        <p className={styles.subtitle}>
          Eres una leyenda de Ritmiq. {streakValue ?? 365} dias seguidos.
        </p>

        <button
          type="button"
          className={styles.continueBtn}
          onClick={onClose}
          autoFocus
        >
          <span className={styles.continueBtnText}>Continuar</span>
        </button>
      </div>
    </div>
  );
}
