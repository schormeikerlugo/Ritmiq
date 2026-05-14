/**
 * Fila horizontal scrollable estilo Spotify para Home.
 *
 * Props:
 *  - title:     título de la fila
 *  - subtitle:  línea secundaria opcional ("Porque escuchaste X")
 *  - items:     array a renderizar
 *  - renderItem (item, index) => JSX
 *  - onPlayAll: opcional, callback del botón "Reproducir todo"
 */
import { Icon } from '../Icon/Icon.jsx';
import styles from './HomeRow.module.css';

export function HomeRow({ title, subtitle, items, renderItem, onPlayAll }) {
  if (!items || items.length === 0) return null;
  return (
    <section className={styles.row}>
      <header className={styles.head}>
        <div className={styles.titleBlock}>
          <h2 className={styles.title}>{title}</h2>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {onPlayAll && (
          <button
            type="button"
            className={styles.playAll}
            onClick={onPlayAll}
            aria-label={`Reproducir ${title}`}
          >
            <Icon name="Play" size={16} filled />
            <span>Reproducir</span>
          </button>
        )}
      </header>
      <div className={styles.scroll}>
        {items.map((item, i) => (
          <div key={item?.id ?? item?.ytId ?? item?.artist ?? i} className={styles.item}>
            {renderItem(item, i)}
          </div>
        ))}
      </div>
    </section>
  );
}
