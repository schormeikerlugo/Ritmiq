/**
 * ActivityHeatmap — grid GitHub-style de actividad de escucha.
 *
 * 53 columnas (semanas) x 7 filas (días L-D). Cada celda representa un
 * día y su color refleja el número de plays. Buckets de intensidad
 * basados en percentiles del propio dataset (no en valores absolutos),
 * así un usuario de bajo volumen también ve gradiente.
 *
 * Layout responsive:
 *   - El SVG usa viewBox + `width:100%` con `max-width` = ancho natural.
 *     En desktop cabe COMPLETO ajustándose al panel (celdas se escalan
 *     hacia abajo si hace falta, hasta un mínimo legible).
 *   - El contenedor de scroll tiene `min-width` en el SVG: si el panel
 *     es más angosto que ese mínimo (PWA móvil), aparece scroll
 *     horizontal con hint de sombra en los bordes.
 *
 * Hover muestra tooltip con fecha + count.
 *
 * @module @ritmiq/ui/components/StatsView/ActivityHeatmap
 */
import { useMemo, useState } from 'react';
import styles from './ActivityHeatmap.module.css';

const CELL = 12;
const GAP  = 3;
const WEEKS = 53;
const DAYS  = 7;
const MONTH_LABEL_H = 18;
const DAY_LABEL_W = 30;
// Separación mínima (en columnas/semanas) entre dos etiquetas de mes para
// que no se solapen. Cada semana mide CELL+GAP px; con ~3 semanas hay
// espacio de sobra para un label de 3 letras.
const MONTH_LABEL_MIN_GAP_WEEKS = 3;

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DAY_NAMES   = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

/** Agrupa eventos por día (YYYY-MM-DD local). */
function aggregateByDay(events) {
  const counts = new Map();
  for (const e of events ?? []) {
    const ts = e?.playedAt ?? e?.played_at ?? null;
    if (!ts) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** 53 semanas x 7 días retrocediendo desde HOY. */
function buildGrid(counts) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7; // 0=Lunes
  const cells = [];
  const start = new Date(today);
  start.setDate(today.getDate() - ((WEEKS - 1) * 7 + dow));

  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + w * 7 + d);
      const k = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const count = counts.get(k) ?? 0;
      const future = cur.getTime() > today.getTime();
      cells.push({ date: cur, key: k, count, week: w, day: d, future });
    }
  }
  return cells;
}

/** Nivel 0..4 según percentil dentro del dataset > 0. */
function buildLevelFn(counts) {
  const positives = Array.from(counts.values()).filter((v) => v > 0).sort((a, b) => a - b);
  if (positives.length === 0) return () => 0;
  const p25 = positives[Math.floor(positives.length * 0.25)] ?? 1;
  const p50 = positives[Math.floor(positives.length * 0.50)] ?? p25;
  const p75 = positives[Math.floor(positives.length * 0.75)] ?? p50;
  return (count) => {
    if (count <= 0) return 0;
    if (count <= p25) return 1;
    if (count <= p50) return 2;
    if (count <= p75) return 3;
    return 4;
  };
}

export function ActivityHeatmap({ events, title = 'Actividad anual' }) {
  const counts = useMemo(() => aggregateByDay(events), [events]);
  const grid = useMemo(() => buildGrid(counts), [counts]);
  const levelOf = useMemo(() => buildLevelFn(counts), [counts]);
  const [hover, setHover] = useState(null);

  // Etiquetas de meses (primer día visible de cada mes), filtrando las que
  // quedarían demasiado juntas para evitar solapes tipo "MayJun".
  const monthLabels = useMemo(() => {
    const labels = [];
    let lastMonth = -1;
    let lastWeekPlaced = -MONTH_LABEL_MIN_GAP_WEEKS;
    for (let w = 0; w < WEEKS; w++) {
      const firstCell = grid[w * DAYS];
      if (!firstCell) continue;
      const month = firstCell.date.getMonth();
      if (month !== lastMonth) {
        lastMonth = month;
        if (w - lastWeekPlaced >= MONTH_LABEL_MIN_GAP_WEEKS) {
          labels.push({ week: w, label: MONTH_NAMES[month] });
          lastWeekPlaced = w;
        }
      }
    }
    return labels;
  }, [grid]);

  const svgWidth  = DAY_LABEL_W + WEEKS * (CELL + GAP);
  const svgHeight = MONTH_LABEL_H + DAYS * (CELL + GAP);

  const totalPlays = useMemo(
    () => Array.from(counts.values()).reduce((s, v) => s + v, 0),
    [counts],
  );
  const activeDays = useMemo(
    () => Array.from(counts.values()).filter((v) => v > 0).length,
    [counts],
  );

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.sub}>
          {totalPlays} reproducciones en {activeDays} {activeDays === 1 ? 'día' : 'días'} del último año.
        </p>
      </header>

      <div className={styles.scroll}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className={styles.svg}
          style={{ minWidth: `${svgWidth * 0.62}px`, maxWidth: `${svgWidth}px` }}
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label={`Mapa de actividad: ${totalPlays} reproducciones en ${activeDays} días del último año`}
        >
          {/* Etiquetas de meses */}
          {monthLabels.map(({ week, label }) => (
            <text
              key={`${week}-${label}`}
              x={DAY_LABEL_W + week * (CELL + GAP)}
              y={MONTH_LABEL_H - 5}
              className={styles.monthLabel}
            >
              {label}
            </text>
          ))}

          {/* Etiquetas de días (Lun/Mié/Vie) */}
          {DAY_NAMES.map((label, i) => (
            (i === 0 || i === 2 || i === 4) && (
              <text
                key={label}
                x={DAY_LABEL_W - 8}
                y={MONTH_LABEL_H + i * (CELL + GAP) + CELL - 2}
                className={styles.dayLabel}
                textAnchor="end"
              >
                {label}
              </text>
            )
          ))}

          {/* Celdas */}
          {grid.map((cell) => {
            if (cell.future) return null;
            const level = levelOf(cell.count);
            return (
              <rect
                key={cell.key}
                x={DAY_LABEL_W + cell.week * (CELL + GAP)}
                y={MONTH_LABEL_H + cell.day * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2.5}
                className={styles.cell}
                data-level={level}
                onMouseEnter={() => setHover(cell)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>
      </div>

      <div className={styles.footer}>
        {hover ? (
          <div className={styles.tooltip} role="status">
            <strong>{hover.count}</strong>{' '}
            {hover.count === 1 ? 'reproducción' : 'reproducciones'}{' '}
            el {hover.date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        ) : (
          <span className={styles.footHint}>Pasa el cursor sobre un día para ver el detalle.</span>
        )}

        <div className={styles.legend} aria-label="Leyenda de intensidad">
          <span className={styles.legendLabel}>Menos</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <span key={lvl} className={styles.legendCell} data-level={lvl} />
          ))}
          <span className={styles.legendLabel}>Más</span>
        </div>
      </div>
    </div>
  );
}
