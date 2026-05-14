/**
 * Skeleton de fila para Home: muestra `count` cards grises pulsando
 * mientras la fila real está cargando datos del servidor.
 *
 * Se renderiza con la misma estructura visual que `<HomeRow>` para que el
 * layout no salte cuando llegan los datos reales.
 */
import styles from './RowSkeleton.module.css';

export function RowSkeleton({ title, count = 5 }) {
  return (
    <section className={styles.row}>
      <header className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
      </header>
      <div className={styles.scroll}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={styles.card}>
            <div className={styles.cover} />
            <div className={styles.line} style={{ width: '85%' }} />
            <div className={styles.line} style={{ width: '60%' }} />
          </div>
        ))}
      </div>
    </section>
  );
}
