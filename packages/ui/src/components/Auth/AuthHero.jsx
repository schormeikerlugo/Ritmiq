import { useMemo } from 'react';
import styles from './AuthHero.module.css';
import logoUrl from '../../assets/logotipo.png';

/**
 * Hero visual del AuthScreen: waveform abstracto animado.
 *
 * - SVG con N barras verticales con altura base variable + animacion CSS
 *   independiente por barra (scaleY oscilante con delay desfasado).
 * - Gradient lineal de color que recorre los colores de marca (morado, cian,
 *   rosa, verde) y se traslada lentamente.
 * - Tagline grande + sub.
 * - Acepta `compact` para mobile (menos barras, tagline mas pequeño).
 *
 * @param {{ compact?: boolean }} props
 */
export function AuthHero({ compact = false }) {
  const BAR_COUNT = compact ? 32 : 56;
  // Genera alturas pseudoaleatorias estables (basadas en el indice, no random)
  // para que cada barra tenga personalidad y no se vea uniforme.
  const bars = useMemo(() => {
    const out = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      // Mezcla de senos con distintas frecuencias para que parezca organico
      const t = i / BAR_COUNT;
      const a = Math.sin(t * Math.PI * 3.1) * 0.5 + 0.5;
      const b = Math.sin(t * Math.PI * 7.7 + 1.3) * 0.5 + 0.5;
      const c = Math.sin(t * Math.PI * 13.0 + 2.1) * 0.5 + 0.5;
      const base = 0.18 + a * 0.45 + b * 0.20 + c * 0.12; // 0.18..0.95
      // Cada barra tiene su propia velocidad y delay
      const dur = 2.2 + ((i * 73) % 100) / 100 * 1.8; // 2.2..4.0s
      const delay = ((i * 37) % 100) / 100 * -3; // -3..0s (negativo arranca avanzado)
      const amp = 0.35 + ((i * 53) % 100) / 100 * 0.45; // 0.35..0.80 (cuanto crece)
      out.push({ i, base, dur, delay, amp });
    }
    return out;
  }, [BAR_COUNT]);

  return (
    <div className={[styles.hero, compact && styles.heroCompact].filter(Boolean).join(' ')}>
      <div className={styles.bgGlow} aria-hidden="true" />

      <div className={styles.content}>
        <img
          src={logoUrl}
          alt="Ritmiq"
          className={styles.logo}
          draggable={false}
        />

        <svg
          className={styles.waveform}
          viewBox={`0 0 ${BAR_COUNT * 8} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="ritmiqWave" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7c5cff" />
              <stop offset="33%" stopColor="#5cd0ff" />
              <stop offset="66%" stopColor="#ff5d8f" />
              <stop offset="100%" stopColor="#3ddc97" />
            </linearGradient>
            <linearGradient id="ritmiqWaveSoft" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(124,92,255,0.35)" />
              <stop offset="33%" stopColor="rgba(92,208,255,0.30)" />
              <stop offset="66%" stopColor="rgba(255,93,143,0.28)" />
              <stop offset="100%" stopColor="rgba(61,220,151,0.30)" />
            </linearGradient>
          </defs>

          <g className={styles.waveGroup}>
            {bars.map((b) => {
              const x = b.i * 8 + 1; // barras de 6px de ancho con 2px de gap
              const h = b.base * 100;
              const y = (100 - h) / 2;
              return (
                <rect
                  key={b.i}
                  className={styles.bar}
                  x={x}
                  y={y}
                  width={6}
                  height={h}
                  rx={3}
                  style={{
                    transformOrigin: `${x + 3}px 50px`,
                    animationDuration: `${b.dur}s`,
                    animationDelay: `${b.delay}s`,
                    // CSS custom prop para que el keyframe sepa cuanto crecer
                    '--amp': b.amp.toFixed(3),
                  }}
                />
              );
            })}
          </g>
        </svg>

        <div className={styles.copy}>
          <h1 className={styles.tagline}>
            Donde la música suena <span className={styles.taglineAccent}>con tus amigos</span>
          </h1>
          {!compact && (
            <p className={styles.sub}>
              Reproduce, comparte y descubre canciones juntos.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
