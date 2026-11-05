/**
 * `<img>` de portada de canción con la portada oficial si el servidor la
 * identificó (lib/track-art.js). Si la imagen falla, vuelve a la miniatura
 * original de YouTube.
 *
 * Uso: <TrackImg track={t} size={300} loading="lazy" />
 *
 * @module @ritmiq/ui/components/primitives/TrackImg
 */
import { useState } from 'react';
import { useTrackCover } from '../../lib/track-art.js';

/**
 * @param {{ track: object, size?: 300|1000, priority?: boolean, className?: string,
 *   loading?: 'lazy'|'eager', alt?: string }} props
 */
export function TrackImg({ track, size = 300, priority = false, className, loading, alt = '' }) {
  const src = useTrackCover(track, size, { priority });
  const [failed, setFailed] = useState(null);
  const finalSrc = failed === src ? track?.coverUrl : src;
  if (!finalSrc) return null;
  return (
    <img
      className={className}
      src={finalSrc}
      alt={alt}
      loading={loading}
      decoding="async"
      onError={() => { if (src !== track?.coverUrl) setFailed(src); }}
    />
  );
}
