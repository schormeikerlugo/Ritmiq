/**
 * Letra a pantalla completa en la TV, estilo karaoke: fondo de color sólido
 * sacado de la portada, letra grande en negrita, la línea actual en blanco,
 * y el resto en blanco translúcido, en una columna centrada. La línea actual
 * queda a media altura (desplazamiento con transform, barato en el onn.) y
 * los cambios se animan con color/opacity/transform.
 *
 * Letra sin sincronizar (o mientras el servidor la sincroniza): texto completo
 * que baja solo según el avance de la canción, con aviso; ↑/↓ la mueven a
 * mano durante 8 s (role=slider vertical, así lib/tv-nav.js no mueve el foco).
 *
 * @module @ritmiq/ui/components/TvNowPlaying/TvLyrics
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTrackLyrics } from '../../stores/lyrics.js';
import { usePlayerStore } from '../../stores/player.js';
import { getDominantColor } from '../../lib/dominant-color.js';
import { useTrackCover } from '../../lib/track-art.js';
import styles from './TvLyrics.module.css';

const FALLBACK_BG = 'hsl(262 45% 38%)';

/** Color de fondo legible con texto blanco y negro (como en Spotify). */
function lyricsBg(rgb) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb ?? '');
  if (!m) return FALLBACK_BG;
  const [r, g, b] = m.slice(1).map((n) => Number(n) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  // Portadas grises: tono neutro algo saturado para que no quede apagado.
  const sat = s < 0.12 ? 0.12 : Math.max(0.4, Math.min(0.75, s));
  return `hsl(${Math.round(h)} ${Math.round(sat * 100)}% 40%)`;
}

function activeIndex(parsed, ms) {
  let lo = 0;
  let hi = parsed.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (parsed[mid].timeMs <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function TvLyrics({ track, idle = false }) {
  const position = usePlayerStore((s) => s.positionSeconds);
  const { entry, key } = useTrackLyrics(track);

  // Color de la portada oficial si la hay (más fiel que el fotograma).
  const cover = useTrackCover(track, 300);
  const [bg, setBg] = useState(FALLBACK_BG);
  useEffect(() => {
    let alive = true;
    getDominantColor(cover).then((c) => { if (alive) setBg(lyricsBg(c)); }).catch(() => {});
    return () => { alive = false; };
  }, [cover]);

  const parsed = entry?.parsed?.length ? entry.parsed : null;
  const active = parsed ? activeIndex(parsed, position * 1000) : -1;

  // Desplazamiento: la línea actual al ~30 % de la altura.
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const [offset, setOffset] = useState(0);
  // La zona visible cambia de alto al entrar/salir del reposo (transición de
  // 500 ms): recalcular al terminar.
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setSettled((n) => n + 1), 550);
    return () => clearTimeout(t);
  }, [idle]);
  useLayoutEffect(() => {
    if (!parsed) return;
    const box = boxRef.current;
    const el = listRef.current?.children[Math.max(0, active)];
    if (!box || !el) return;
    // Línea actual centrada en la zona visible (como en la referencia).
    setOffset(Math.max(0, el.offsetTop + el.offsetHeight / 2 - box.clientHeight * 0.45));
  }, [active, parsed, settled]);

  // Letra sin sincronizar: baja según el avance (a mitad de canción, mitad
  // de la letra, empezando un poco después del inicio). ↑/↓ a mano 8 s.
  const duration = track?.durationSeconds || 0;
  const [manual, setManual] = useState(null); // { offset, until }
  useEffect(() => { setManual(null); }, [key]);
  const plainMax = Math.max(0, (listRef.current?.scrollHeight ?? 0) - (boxRef.current?.clientHeight ?? 0) * 0.6);
  const progress = duration > 0 ? Math.min(1, Math.max(0, (position - 10) / Math.max(1, duration - 25))) : 0;
  const autoOffset = Math.round(progress * plainMax);
  const plainOffset = manual && manual.until > Date.now() ? manual.offset : autoOffset;
  const onPlainKey = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const next = Math.max(0, Math.min(plainMax, plainOffset + (e.key === 'ArrowDown' ? 160 : -160)));
    setManual({ offset: next, until: Date.now() + 8000 });
  };

  let body;
  if (!entry || entry.loading) {
    body = <p className={styles.msg}>Buscando la letra…</p>;
  } else if (entry.instrumental) {
    body = <p className={styles.msg}>♪ Instrumental ♪</p>;
  } else if (entry.error || !entry.found || (!parsed && !entry.plain)) {
    body = <p className={styles.msg}>No encontramos la letra de esta canción.</p>;
  } else if (parsed) {
    body = (
      <ol ref={listRef} className={styles.lines} style={{ transform: `translateY(${-offset}px)` }}>
        {parsed.map((line, i) => (
          <li
            key={`${line.timeMs}-${i}`}
            className={styles.line}
            data-state={i === active ? 'now' : i < active ? 'past' : 'next'}
          >
            {line.text || '♪'}
          </li>
        ))}
      </ol>
    );
  } else {
    body = (
      <div
        ref={listRef}
        className={styles.plain}
        data-auto={!(manual && manual.until > Date.now()) || undefined}
        style={{ transform: `translateY(${-plainOffset}px)` }}
        role="slider"
        data-tv-axis="vertical"
        tabIndex={0}
        aria-label="Letra (↑ ↓ para desplazar)"
        aria-valuenow={plainOffset}
        onKeyDown={onPlainKey}
      >
        {entry.plain}
      </div>
    );
  }

  const status = entry && !entry.loading && !parsed && entry.plain
    ? (entry.syncing ? 'Sincronizando la letra con la canción…' : 'Letra sin sincronizar')
    : null;

  return (
    <div className={styles.root} style={{ background: bg }} data-idle={idle || undefined}>
      {status && <span className={styles.status}>{status}</span>}
      <div ref={boxRef} className={styles.box} key={key}>{body}</div>
    </div>
  );
}
