/**
 * Skeleton — componente generico de placeholder con animacion shimmer.
 *
 * Variantes:
 *   - 'text'   → bloque horizontal (linea de texto). Height default 0.85em.
 *   - 'rect'   → bloque rectangular generico.
 *   - 'circle' → circulo (avatar/thumb).
 *
 * Props:
 *   - variant?: 'text' | 'rect' | 'circle'   (default: 'rect')
 *   - width?:   number | string              (px o cualquier unidad CSS)
 *   - height?:  number | string
 *   - count?:   number                       (renderiza N skeletons stackeados)
 *   - className?: string                     (extra classes; ej. para gap o radius)
 *   - style?:   React.CSSProperties
 *
 * Composiciones predefinidas (ver index.js):
 *   - <TrackRowSkeleton count={8} />   filas de tracks (cover + 2 lineas)
 *   - <HeroSkeleton />                 hero con cover grande + titulo + meta
 *   - <GridCardSkeleton count={12} />  grid de cards cuadradas
 *
 * Reutiliza @keyframes ritmiq-shimmer de tokens.css.
 *
 * @module @ritmiq/ui/components/Skeleton/Skeleton
 */
import styles from './Skeleton.module.css';

/**
 * @param {Object} props
 * @param {'text'|'rect'|'circle'} [props.variant='rect']
 * @param {number|string} [props.width]
 * @param {number|string} [props.height]
 * @param {number} [props.count=1]
 * @param {string} [props.className]
 * @param {React.CSSProperties} [props.style]
 */
export function Skeleton({
  variant = 'rect',
  width,
  height,
  count = 1,
  className,
  style,
}) {
  const computed = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    ...style,
  };

  const cls = [
    styles.skeleton,
    styles[`variant_${variant}`],
    className,
  ].filter(Boolean).join(' ');

  if (count === 1) {
    return <span className={cls} style={computed} aria-hidden="true" />;
  }
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className={cls} style={computed} aria-hidden="true" />
      ))}
    </>
  );
}

/**
 * Composicion: fila de track (cover cuadrado + titulo + subtitulo).
 * Reemplaza el listado mientras carga.
 *
 * @param {{ count?: number }} [props]
 */
export function TrackRowSkeleton({ count = 6 }) {
  return (
    <ul className={styles.list} aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className={styles.row}>
          <Skeleton variant="rect" width={44} height={44} className={styles.rowCover} />
          <div className={styles.rowMeta}>
            <Skeleton variant="text" width={`${60 + ((i * 13) % 30)}%`} />
            <Skeleton variant="text" width={`${30 + ((i * 7) % 25)}%`} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Composicion: hero de PlaylistView / ArtistView / AlbumView mientras
 * carga la metadata. Cover grande + titulo + linea meta.
 */
export function HeroSkeleton() {
  return (
    <div className={styles.hero} aria-busy="true">
      <Skeleton variant="rect" width={220} height={220} className={styles.heroCover} />
      <div className={styles.heroMeta}>
        <Skeleton variant="text" width="40%" height={14} />
        <Skeleton variant="text" width="70%" height={32} />
        <Skeleton variant="text" width="50%" height={14} />
      </div>
    </div>
  );
}

/**
 * Composicion: grid de cards cuadradas con label debajo.
 *
 * @param {{ count?: number }} [props]
 */
export function GridCardSkeleton({ count = 8 }) {
  return (
    <div className={styles.grid} aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.gridCard}>
          <Skeleton variant="rect" className={styles.gridCardCover} />
          <Skeleton variant="text" width="85%" />
          <Skeleton variant="text" width="55%" />
        </div>
      ))}
    </div>
  );
}
