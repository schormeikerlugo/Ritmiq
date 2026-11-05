/**
 * Letra a pantalla completa en la TV, estilo karaoke: fondo de color sólido
 * sacado de la portada, letra grande en negrita, la línea actual en blanco,
 * las ya cantadas en blanco suave y las siguientes en oscuro. La línea
 * actual se coloca hacia el tercio superior (desplazamiento con transform,
 * barato en el onn.).
 *
 * Letra sin sincronizar: texto completo en blanco; ↑/↓ la desplazan
 * (role=slider vertical, así lib/tv-nav.js no mueve el foco).
 *
 * @module @ritmiq/ui/components/TvNowPlaying/TvLyrics
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLyricsStore } from '../../stores/lyrics.js';
import { usePlayerStore } from '../../stores/player.js';
import { getDominantColor } from '../../lib/dominant-color.js';
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

export function TvLyrics({ track }) {
  const fetchLyrics = useLyricsStore((s) => s.fetch);
  const position = usePlayerStore((s) => s.positionSeconds);
  const params = {
    artist: track?.artist ?? '',
    title: track?.title ?? '',
    duration: track?.durationSeconds ?? null,
  };
  // Misma clave que stores/lyrics.js (ver LyricsPanel).
  const key = useMemo(() => {
    const a = String(params.artist).trim().toLowerCase();
    const t = String(params.title).trim().toLowerCase();
    const bucket = params.duration ? Math.round(params.duration / 5) * 5 : 0;
    return `${a}::${t}::${bucket}`;
  }, [params.artist, params.title, params.duration]);
  const entry = useLyricsStore((s) => s.entries[key]);

  useEffect(() => {
    if (params.artist && params.title) fetchLyrics(params).catch(() => {});
  }, [params.artist, params.title, params.duration, fetchLyrics]);

  const [bg, setBg] = useState(FALLBACK_BG);
  useEffect(() => {
    let alive = true;
    getDominantColor(track?.coverUrl).then((c) => { if (alive) setBg(lyricsBg(c)); }).catch(() => {});
    return () => { alive = false; };
  }, [track?.coverUrl]);

  const parsed = entry?.parsed?.length ? entry.parsed : null;
  const active = parsed ? activeIndex(parsed, position * 1000) : -1;

  // Desplazamiento: la línea actual al ~30 % de la altura.
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    if (!parsed) return;
    const box = boxRef.current;
    const el = listRef.current?.children[Math.max(0, active)];
    if (!box || !el) return;
    setOffset(Math.max(0, el.offsetTop - box.clientHeight * 0.3));
  }, [active, parsed]);

  // Letra sin sincronizar: ↑/↓ desplazan.
  const [plainOffset, setPlainOffset] = useState(0);
  useEffect(() => { setPlainOffset(0); }, [key]);
  const onPlainKey = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const max = Math.max(0, (listRef.current?.scrollHeight ?? 0) - (boxRef.current?.clientHeight ?? 0));
    setPlainOffset((o) => Math.max(0, Math.min(max, o + (e.key === 'ArrowDown' ? 160 : -160))));
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

  return (
    <div className={styles.root} style={{ background: bg }}>
      <div ref={boxRef} className={styles.box}>{body}</div>
    </div>
  );
}
