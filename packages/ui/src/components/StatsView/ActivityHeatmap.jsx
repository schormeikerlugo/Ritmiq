/**
 * ActivityHeatmap \u2014 grid GitHub-style de actividad de escucha.
 *
 * 53 columnas (semanas) x 7 filas (dias L-D). Cada celda representa un
 * dia y su color refleja el numero de plays. Buckets de intensidad
 * basados en percentiles del propio dataset (no en valores absolutos),
 * asi un usuario de bajo volumen tambien ve gradiente.
 *
 * Hover muestra tooltip con fecha + count.
 *
 * Render:
 *   - SVG 53*cell x 7*cell + labels de meses arriba + dias a la izq.
 *   - Cell size 12px, gap 2px. Total ~750x100 mas labels.
 *   - 5 niveles de intensidad: 0 (sin plays) y 4 buckets accent.
 *
 * @module @ritmiq/ui/components/StatsView/ActivityHeatmap
 */
import { useMemo, useState } from 'react';
import styles from './ActivityHeatmap.module.css';

const CELL = 12;
const GAP  = 2;
const WEEKS = 53;
const DAYS  = 7;
const MONTH_LABEL_H = 16;
const DAY_LABEL_W = 24;

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DAY_NAMES   = ['Lun','Mar','Mie','Jue','Vie','Sab','Dom'];

/**
 * Agrupa eventos por dia (YYYY-MM-DD). Toma el atributo playedAt
 * (ISO string) o playedAtTimestamp.
 */
function aggregateByDay(events) {
  const counts = new Map();
  for (const e of events ?? []) {
    const ts = e?.playedAt ?? e?.played_at ?? null;
    if (!ts) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    // Key local YYYY-MM-DD para alinear con la zona horaria del usuario.
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * Devuelve un array de 53 semanas x 7 dias retrocediendo desde HOY.
 * dayOffset 0 = primera columna (mas vieja), DAYS*WEEKS-1 = hoy.
 */
function buildGrid(counts) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Encontramos el lunes de la semana actual. JS Date: getDay()=0=Domingo.
  const dow = (today.getDay() + 6) % 7; // 0=Lunes
  const cells = [];
  // Empezamos hace 52 semanas + dow dias.
  const start = new Date(today);
  start.setDate(today.getDate() - ((WEEKS - 1) * 7 + dow));

  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < DAYS; d++) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + w * 7 + d);
      const k = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const count = counts.get(k) ?? 0;
      const future = cur.getTime() > today.getTime();
      cells.push({
        date: cur,
        key: k,
        count,
        week: w,
        day: d,
        future,
      });
    }
  }
  return cells;
}

/** Devuelve nivel 0..4 segun percentile dentro del dataset > 0. */
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

  // Calcula posiciones de etiquetas de meses (primer dia visible de cada mes).
  const monthLabels = useMemo(() => {
    const labels = [];
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const firstCell = grid[w * DAYS];
      if (!firstCell) continue;
      const month = firstCell.date.getMonth();
      if (month !== lastMonth) {
        labels.push({ week: w, label: MONTH_NAMES[month] });
        lastMonth = month;
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
          {totalPlays} reproducciones en {activeDays} {activeDays === 1 ? 'dia' : 'dias'} del ultimo ano.
        </p>
      </header>

      <div className={styles.scroll}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          width={svgWidth}
          height={svgHeight}
          className={styles.svg}
        >
          {/* Etiquetas de meses arriba */}
          {monthLabels.map(({ week, label }) => (
            <text
              key={`${week}-${label}`}
              x={DAY_LABEL_W + week * (CELL + GAP)}
              y={MONTH_LABEL_H - 4}
              className={styles.monthLabel}
            >
              {label}
            </text>
          ))}

          {/* Etiquetas de dias a la izquierda (solo Lun/Mie/Vie para no
              saturar) */}
          {DAY_NAMES.map((label, i) => (
            (i === 0 || i === 2 || i === 4) && (
              <text
                key={label}
                x={DAY_LABEL_W - 6}
                y={MONTH_LABEL_H + i * (CELL + GAP) + CELL - 3}
                className={styles.dayLabel}
                textAnchor="end"
              >
                {label}
              </text>
            )
          ))}

          {/* Cells */}
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
                rx={2}
                className={styles.cell}
                data-level={level}
                onMouseEnter={() => setHover(cell)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>
      </div>

      {hover && (
        <div className={styles.tooltip} role="status">
          <strong>{hover.count}</strong>{' '}
          {hover.count === 1 ? 'reproduccion' : 'reproducciones'}{' '}
          el {hover.date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      )}

      <div className={styles.legend} aria-label="Leyenda de intensidad">
        <span className={styles.legendLabel}>Menos</span>
        {[0, 1, 2, 3, 4].map((lvl) => (
          <span key={lvl} className={styles.legendCell} data-level={lvl} />
        ))}
        <span className={styles.legendLabel}>Mas</span>
      </div>
    </div>
  );
}
