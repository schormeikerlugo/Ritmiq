/**
 * Fila horizontal scrollable estilo Spotify para Home.
 *
 * Props:
 *  - title:     título de la fila
 *  - subtitle:  línea secundaria opcional ("Porque escuchaste X")
 *  - items:     array a renderizar
 *  - renderItem (item, index) => JSX
 *  - onPlayAll: opcional, callback del botón "Reproducir todo"
 *  - loading:   si true Y items.length===0 muestra skeleton en vez de null.
 *               Si items ya tiene contenido se ignora (no parpadeamos).
 */
import { useRef } from 'react';
import { Icon } from '../Icon/Icon.jsx';
import { RowSkeleton } from './RowSkeleton.jsx';
import { useViewTransition } from '../../lib/use-view-transition.js';
import styles from './HomeRow.module.css';

export function HomeRow({ title, subtitle, items, renderItem, onPlayAll, loading }) {
  const empty = !items || items.length === 0;
  // El ref + hook se llaman SIEMPRE para mantener orden estable de hooks
  // a traves de renders, aunque el early-return los haga no-op cuando
  // empty=true (porque scrollRef.current sera null).
  const scrollRef = useRef(null);
  // Stagger entrada de cards en el primer mount de la fila. Cuando
  // items.length crece (paginacion), no re-disparamos porque deps=[].
  // Las items nuevas aparecen sin animacion individual \u2014 aceptable.
  useViewTransition(scrollRef, {
    preset: 'stagger',
    childSelector: `.${styles.item}`,
    staggerEach: 0.035,
    duration: 0.32,
    disabled: empty,
  });

  if (empty && loading) return <RowSkeleton title={title} count={5} />;
  if (empty) return null;
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
      <div ref={scrollRef} className={styles.scroll}>
        {items.map((item, i) => (
          <div key={item?.id ?? item?.ytId ?? item?.artist ?? i} className={styles.item}>
            {renderItem(item, i)}
          </div>
        ))}
      </div>
    </section>
  );
}
