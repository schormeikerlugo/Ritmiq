/**
 * Skeleton de fila para Home: muestra `count` cards con shimmer mientras
 * la fila real esta cargando datos del servidor.
 *
 * Se renderiza con la misma estructura visual que <HomeRow> (incluyendo
 * subtitle placeholder y boton "Reproducir todo") para que el layout no
 * salte cuando llegan los datos reales.
 *
 * Variantes:
 *   - shape='square' (default) \u2014 cards cuadradas (tracks/playlists).
 *   - shape='circle'           \u2014 cards circulares (artistas).
 *
 * Si `subtitle=true` (default) reserva espacio para la linea sub-titulo
 * y el boton Reproducir.
 */
import styles from './RowSkeleton.module.css';

export function RowSkeleton({ title, count = 5, shape = 'square', subtitle = true }) {
  return (
    <section className={styles.row}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.title}>{title}</h2>
          {subtitle && <span className={styles.subLine} aria-hidden="true" />}
        </div>
        {subtitle && (
          <span className={styles.playBtnSkel} aria-hidden="true">
            <span className={styles.playBtnDot} />
            <span className={styles.playBtnLine} />
          </span>
        )}
      </header>
      <div className={styles.scroll}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={styles.card}>
            <div
              className={[
                styles.cover,
                shape === 'circle' ? styles.coverCircle : '',
              ].filter(Boolean).join(' ')}
            />
            <div className={styles.line} style={{ width: `${70 + ((i * 11) % 20)}%` }} />
            <div className={styles.line} style={{ width: `${40 + ((i * 7) % 20)}%` }} />
          </div>
        ))}
      </div>
    </section>
  );
}
