/**
 * CoverArt \u2014 muestra una caratula con fallback a gradient generado.
 *
 * Hoy varias vistas usan `<img src={coverUrl}>` directo: cuando coverUrl
 * es null o la imagen falla en cargar, queda un hueco gris. Este primitive:
 *
 *   1. Si hay coverUrl, renderiza <img> con onError fallback al gradient.
 *   2. Si no, genera un gradient determinista a partir de `seed` (titulo
 *      del track o artista). Mismo seed = mismo gradient siempre.
 *   3. Opcionalmente muestra inicial(es) del seed centradas encima.
 *
 * Uso:
 *   <CoverArt coverUrl={track.coverUrl} seed={track.title} alt="" />
 *   <CoverArt seed="Bad Bunny" size={56} initials="BB" />
 *
 * @param {{
 *   coverUrl?: string | null,
 *   seed?: string,                titulo o artista para hash. default ''.
 *   alt?: string,                 alt del <img>. default ''.
 *   size?: number | string,       width+height. default '100%'.
 *   radius?: 'sm'|'md'|'lg'|'pill'|'circle'|number,  borde. default 'sm'.
 *   initials?: string | boolean,  si es string, muestra ese texto. Si es
 *     true (default), deriva 1-2 letras de seed. false: sin texto.
 *   loading?: 'lazy' | 'eager',   default 'lazy'.
 *   className?: string,           extra clases para el wrapper.
 *   onClick?: () => void,         opcional click handler.
 * }} props
 */
import { useMemo, useState } from 'react';
import styles from './CoverArt.module.css';

/** Hash 32-bit deterministico de un string (FNV-1a). */
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Devuelve { hue1, hue2 } estables a partir de seed. */
function gradientForSeed(seed) {
  if (!seed) return { hue1: 260, hue2: 280 }; // accent default
  const h = hashString(seed);
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + ((h >> 8) % 60)) % 360; // separacion 40-100 grados
  return { hue1, hue2 };
}

/** Deriva 1-2 letras de seed para mostrar centradas. */
function deriveInitials(seed) {
  if (!seed) return '';
  // Tomamos la primera letra de las primeras 2 palabras.
  const words = String(seed).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function radiusToToken(radius) {
  if (typeof radius === 'number') return `${radius}px`;
  switch (radius) {
    case 'md':     return 'var(--radius-md)';
    case 'lg':     return 'var(--radius-lg)';
    case 'pill':   return 'var(--radius-pill)';
    case 'circle': return '50%';
    case 'sm':
    default:       return 'var(--radius-sm)';
  }
}

export function CoverArt({
  coverUrl,
  seed = '',
  alt = '',
  size,
  radius = 'sm',
  initials = true,
  loading = 'lazy',
  className,
  onClick,
}) {
  // Si la imagen falla, mostramos gradient. State local para el fallback.
  const [imgFailed, setImgFailed] = useState(false);

  const { hue1, hue2 } = useMemo(() => gradientForSeed(seed || alt), [seed, alt]);
  const initialsText = useMemo(() => {
    if (initials === false) return '';
    if (typeof initials === 'string') return initials;
    return deriveInitials(seed || alt);
  }, [initials, seed, alt]);

  const showImage = coverUrl && !imgFailed;

  const wrapperStyle = {
    borderRadius: radiusToToken(radius),
  };
  if (size !== undefined) {
    wrapperStyle.width = typeof size === 'number' ? `${size}px` : size;
    wrapperStyle.height = typeof size === 'number' ? `${size}px` : size;
  }

  // Gradient style aplicado al wrapper cuando no hay imagen.
  if (!showImage) {
    wrapperStyle.background = `linear-gradient(135deg, hsl(${hue1} 65% 38%) 0%, hsl(${hue2} 60% 28%) 100%)`;
  }

  const classes = [styles.cover, className].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={wrapperStyle}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {showImage ? (
        <img
          src={coverUrl}
          alt={alt}
          loading={loading}
          onError={() => setImgFailed(true)}
          className={styles.img}
        />
      ) : (
        initialsText && (
          <span className={styles.initials} aria-hidden="true">{initialsText}</span>
        )
      )}
    </div>
  );
}
