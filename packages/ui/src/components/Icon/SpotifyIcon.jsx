/**
 * Icono de Spotify inline (SVG nativo). Mantengo aparte de la lista
 * de iconos Lucide para que el color verde de marca y la silueta exacta
 * sean inmutables (no depende de un trazo lucide).
 *
 * Uso:
 *   <SpotifyIcon size={20} />
 *   <SpotifyIcon size={20} mono />   // monocromatico, usa currentColor
 *
 * @module @ritmiq/ui/components/Icon/SpotifyIcon
 */

const SPOTIFY_GREEN = '#1DB954';

/**
 * @param {{ size?: number, mono?: boolean, className?: string, ariaHidden?: boolean }} props
 */
export function SpotifyIcon({ size = 18, mono = false, className, ariaHidden = true }) {
  const fill = mono ? 'currentColor' : SPOTIFY_GREEN;
  const ink = mono ? 'var(--color-bg-0, #000)' : '#000';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 168 168"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaHidden}
      className={className}
    >
      <circle cx="84" cy="84" r="84" fill={fill} />
      <path
        fill={ink}
        d="M119.7 117.8c-1.6 2.7-5.1 3.5-7.8 1.9-21.4-13.1-48.3-16-79.9-8.8-3 .7-6.1-1.2-6.8-4.2-.7-3 1.2-6.1 4.2-6.8 34.6-7.9 64.4-4.5 88.5 10.2 2.7 1.6 3.5 5.1 1.8 7.7zm9.5-21.2c-2 3.3-6.4 4.4-9.7 2.4-24.5-15.1-61.9-19.4-90.9-10.6-3.8 1.1-7.7-1-8.8-4.8-1.1-3.8 1-7.7 4.8-8.9 33.2-10 74.5-5.2 102.7 12.1 3.3 2 4.4 6.4 2.4 9.7zm.8-22c-29.4-17.5-78-19.1-106-10.6-4.5 1.4-9.3-1.2-10.7-5.7-1.4-4.5 1.2-9.3 5.7-10.7 32.2-9.8 85.8-7.9 119.7 12.2 4.1 2.4 5.4 7.7 2.9 11.8-2.4 4.1-7.7 5.4-11.6 3z"
      />
    </svg>
  );
}
