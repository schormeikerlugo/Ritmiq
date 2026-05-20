/**
 * Indicador visual de pull-to-refresh. Va arriba del contenedor con
 * overflow scroll y se desplaza con el pullDistance del hook
 * `usePullToRefresh`.
 *
 * Uso:
 *   const { bind, pullDistance, refreshing } = usePullToRefresh({ onRefresh });
 *   <section {...bind} className={styles.wrap}>
 *     <PullIndicator pullDistance={pullDistance} refreshing={refreshing} />
 *     <div style={{ transform: `translateY(${pullDistance}px)` }}>contenido</div>
 *   </section>
 *
 * @module @ritmiq/ui/components/PullToRefresh
 */
import { Icon } from '../Icon/Icon.jsx';
import styles from './PullToRefresh.module.css';

const TRIGGER = 70;

/** @param {{ pullDistance: number, refreshing: boolean }} props */
export function PullIndicator({ pullDistance, refreshing }) {
  const progress = Math.min(1, pullDistance / TRIGGER);
  const rotation = progress * 360;
  const willTrigger = pullDistance >= TRIGGER;
  return (
    <div
      className={styles.indicator}
      data-active={pullDistance > 0 || refreshing}
      data-refreshing={refreshing}
      style={{
        transform: `translate3d(-50%, ${pullDistance - 48}px, 0)`,
        opacity: progress,
      }}
      aria-hidden="true"
    >
      <span
        className={styles.spinner}
        data-spinning={refreshing}
        style={{ transform: refreshing ? undefined : `rotate(${rotation}deg)` }}
      >
        <Icon name={willTrigger || refreshing ? 'Loader2' : 'ChevronDown'} size={20} />
      </span>
    </div>
  );
}
