/**
 * ListView \u2014 primitive de lista vertical con virtualizacion opt-in.
 *
 * Patron recurrente en Ritmiq: Library, Downloads, PlaylistView, Friends,
 * SearchView, History todos renderizan listas de N elementos con altura
 * uniforme + cover + meta. ListView abstrae el shell de la lista (scroll
 * container + virtualizacion) sin imponer un look fijo \u2014 el renderItem
 * controla totalmente cada fila.
 *
 * Virtualizacion:
 *   - virtualize=false (default): renderiza todos los items. Para listas
 *     <= 100 items \u2014 sin overhead, mas simple y permite anchor scroll a
 *     elementos no visibles via querySelector.
 *   - virtualize=true: usa virtualizacion por ventana. Solo renderiza los
 *     items visibles + overscan por arriba/abajo. Para listas > 100.
 *
 * Implementacion sin react-window:
 *   - Calcula viewport en runtime (scrollTop + height del container).
 *   - itemHeight fijo (uniform) \u2014 listas con altura variable no soportadas
 *     en V1; usar virtualize=false.
 *   - Spacer top + spacer bottom de altura calculada para que el scrollbar
 *     refleje el tamano real de la lista completa.
 *   - Throttle de scroll con requestAnimationFrame para evitar
 *     re-renders por frame.
 *
 * Props:
 *   - items:        array de datos.
 *   - renderItem:   (item, index) => ReactNode. Debe envolverse en un
 *                   elemento con `style={...style, height:itemHeight}`
 *                   cuando virtualize=true (ver `getItemStyle`).
 *   - itemHeight:   numero de px. Requerido si virtualize=true.
 *   - virtualize:   default false.
 *   - overscan:     default 4 \u2014 items extra renderizados arriba/abajo.
 *   - keyExtractor: (item, index) => string. Para reconciliacion.
 *   - className:    extra clases del scroll container.
 *   - style:        extra inline styles del container.
 *   - empty:        ReactNode mostrado cuando items.length === 0.
 *   - ariaLabel:    label del role=list (a11y).
 *   - onScroll:     callback con (scrollTop) en cada frame.
 *
 * @example Lista simple sin virtualizacion
 *   <ListView items={tracks} renderItem={(t) => <TrackRow track={t} />} />
 *
 * @example Lista grande con virtualizacion
 *   <ListView
 *     items={bigTracks} virtualize itemHeight={56}
 *     renderItem={(t, i, style) => (
 *       <div style={style}><TrackRow track={t} /></div>
 *     )}
 *   />
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import styles from './ListView.module.css';

const DEFAULT_OVERSCAN = 4;

export function ListView({
  items,
  renderItem,
  itemHeight,
  virtualize = false,
  overscan = DEFAULT_OVERSCAN,
  keyExtractor,
  className,
  style,
  empty,
  ariaLabel,
  onScroll,
}) {
  const total = items?.length ?? 0;
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const rafRef = useRef(0);

  // Mide el viewport al montar y en resize.
  useEffect(() => {
    if (!virtualize) return undefined;
    const el = containerRef.current;
    if (!el) return undefined;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtualize]);

  // Handler de scroll con throttle por rAF.
  const handleScroll = useCallback((e) => {
    if (!virtualize) {
      if (onScroll) onScroll(e.currentTarget.scrollTop);
      return;
    }
    const target = e.currentTarget;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollTop(target.scrollTop);
      if (onScroll) onScroll(target.scrollTop);
    });
  }, [virtualize, onScroll]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // Render vacio.
  if (total === 0 && empty) {
    return (
      <div
        ref={containerRef}
        className={[styles.list, className].filter(Boolean).join(' ')}
        style={style}
        role="list"
        aria-label={ariaLabel}
      >
        {empty}
      </div>
    );
  }

  // ── Camino sin virtualizacion ────────────────────────────────────────
  if (!virtualize) {
    return (
      <div
        ref={containerRef}
        className={[styles.list, className].filter(Boolean).join(' ')}
        style={style}
        onScroll={onScroll ? handleScroll : undefined}
        role="list"
        aria-label={ariaLabel}
      >
        {items.map((item, i) => {
          const key = keyExtractor
            ? keyExtractor(item, i)
            : (item?.id ?? item?.key ?? i);
          return (
            <div key={key} role="listitem" className={styles.row}>
              {renderItem(item, i)}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Camino virtualizado ──────────────────────────────────────────────
  if (!itemHeight || itemHeight <= 0) {
    if (typeof console !== 'undefined') {
      console.warn('[ListView] virtualize=true requiere itemHeight > 0');
    }
  }

  const totalHeight = total * itemHeight;
  const visibleCount = Math.ceil(viewportH / itemHeight) + overscan * 2;
  const startIdx = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIdx = Math.min(total, startIdx + visibleCount);
  const padTop = startIdx * itemHeight;
  const padBottom = Math.max(0, totalHeight - endIdx * itemHeight);

  return (
    <div
      ref={containerRef}
      className={[styles.list, className].filter(Boolean).join(' ')}
      style={style}
      onScroll={handleScroll}
      role="list"
      aria-label={ariaLabel}
    >
      {/* Spacer top para mantener scroll height correcto. */}
      <div aria-hidden="true" style={{ height: padTop }} />
      {items.slice(startIdx, endIdx).map((item, offset) => {
        const i = startIdx + offset;
        const key = keyExtractor
          ? keyExtractor(item, i)
          : (item?.id ?? item?.key ?? i);
        // renderItem recibe un objeto style sugerido con altura fija para
        // que el row no colapse si el contenido es asincrono (covers
        // cargando, skeletons, etc.).
        const itemStyle = { height: itemHeight };
        return (
          <div
            key={key}
            role="listitem"
            className={styles.row}
            style={itemStyle}
          >
            {renderItem(item, i, itemStyle)}
          </div>
        );
      })}
      <div aria-hidden="true" style={{ height: padBottom }} />
    </div>
  );
}
