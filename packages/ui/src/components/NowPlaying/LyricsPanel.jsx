/**
 * LyricsPanel \u2014 panel de letras sincronizadas dentro de NowPlaying.
 *
 * Modos:
 *   - Loading: skeleton de 3 lineas.
 *   - Not found: mensaje "Sin letra disponible" + opcion de buscar
 *     manualmente (futuro \u2014 V1 solo informa).
 *   - Instrumental: badge "Instrumental".
 *   - Found + parsed (synced): muestra ventana de 5 lineas con la actual
 *     resaltada. Auto-scroll suave a la actual.
 *   - Found sin parsed (plain only): muestra el plain text en bloque
 *     scrollable, sin highlight de linea.
 *
 * Click en una linea sincronizada: seek al tiempo de esa linea.
 *
 * Performance:
 *   - findActiveLineIdx() es O(n) sobre `parsed`. Con n < 200 lineas
 *     tipicas, despreciable. Si se vuelve hot path, binary search.
 *   - No usa rAF \u2014 se re-renderiza cuando positionSeconds cambia (el
 *     player ya lo throttle a ~4Hz).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLyricsStore } from '../../stores/lyrics.js';
import { usePlayerStore } from '../../stores/player.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './LyricsPanel.module.css';

function findActiveLineIdx(parsed, positionMs) {
  if (!parsed || parsed.length === 0) return -1;
  // Buscamos la ultima linea cuyo timeMs <= positionMs.
  let lo = 0, hi = parsed.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (parsed[mid].timeMs <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function LyricsPanel({ track }) {
  const fetchLyrics = useLyricsStore((s) => s.fetch);
  const positionSeconds = usePlayerStore((s) => s.positionSeconds);
  const patch = usePlayerStore((s) => s.patch);

  // Seek por click en una linea sincronizada. Replica el patron de
  // NowPlaying.jsx onScrubCommit: actualiza el store + dispatch evento
  // custom ritmiq:seek que use-player.js consume y llama backend.seek().
  const seekToSeconds = (seconds) => {
    patch({ positionSeconds: seconds });
    try {
      window.dispatchEvent(new CustomEvent('ritmiq:seek', { detail: { seconds } }));
    } catch {}
  };

  // Lookup en el store \u2014 selector inline para reaccionar a cambios.
  // No usamos `get(...)` directo porque queremos reactividad.
  const params = {
    artist: track?.artist ?? '',
    title: track?.title ?? '',
    duration: track?.durationSeconds ?? null,
  };
  const key = useMemo(() => {
    const a = String(params.artist ?? '').trim().toLowerCase();
    const t = String(params.title ?? '').trim().toLowerCase();
    const bucket = params.duration ? Math.round(params.duration / 5) * 5 : 0;
    return `${a}::${t}::${bucket}`;
  }, [params.artist, params.title, params.duration]);
  const entry = useLyricsStore((s) => s.entries[key]);

  // Dispara fetch al cambiar el track. fetch() es idempotente: si ya hay
  // entry, no hace nada.
  useEffect(() => {
    if (!params.artist || !params.title) return;
    fetchLyrics(params).catch(() => {});
  }, [params.artist, params.title, params.duration, fetchLyrics]);

  const positionMs = positionSeconds * 1000;
  const activeIdx = useMemo(
    () => findActiveLineIdx(entry?.parsed, positionMs),
    [entry?.parsed, positionMs],
  );

  // Auto-scroll suave a la linea activa.
  const activeRef = useRef(null);
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      // Algunos browsers viejos no soportan scrollIntoView options \u2014
      // fallback silencioso a scroll instantaneo.
      el.scrollIntoView();
    }
  }, [activeIdx]);

  if (!track) return null;

  // Loading.
  if (!entry || entry.loading) {
    return (
      <div className={styles.panel} aria-busy="true">
        <div className={styles.head}>
          <Icon name="Music" size={14} />
          <span>Letra</span>
        </div>
        <div className={styles.skeleton}>
          <div className={styles.line} style={{ width: '70%' }} />
          <div className={styles.line} style={{ width: '85%' }} />
          <div className={styles.line} style={{ width: '60%' }} />
        </div>
      </div>
    );
  }

  // Error.
  if (entry.error) {
    return (
      <div className={styles.panel}>
        <div className={styles.head}>
          <Icon name="AlertCircle" size={14} />
          <span>Letra no disponible</span>
        </div>
        <p className={styles.muted}>{entry.error}</p>
      </div>
    );
  }

  // Instrumental.
  if (entry.instrumental) {
    return (
      <div className={styles.panel}>
        <div className={styles.head}>
          <Icon name="Music" size={14} />
          <span>Instrumental</span>
        </div>
        <p className={styles.muted}>Sin letra para esta cancion.</p>
      </div>
    );
  }

  // Not found.
  if (!entry.found || (!entry.parsed?.length && !entry.plain)) {
    return (
      <div className={styles.panel}>
        <div className={styles.head}>
          <Icon name="Music" size={14} />
          <span>Letra</span>
        </div>
        <p className={styles.muted}>No encontramos letra para esta cancion.</p>
      </div>
    );
  }

  // Synced lyrics.
  if (entry.parsed && entry.parsed.length > 0) {
    return (
      <div className={styles.panel} data-mode="synced">
        <div className={styles.head}>
          <Icon name="Music" size={14} />
          <span>Letra sincronizada</span>
        </div>
        <ol className={styles.lines}>
          {entry.parsed.map((line, i) => {
            const isActive = i === activeIdx;
            const distance = Math.abs(i - activeIdx);
            return (
              <li
                key={`${line.timeMs}-${i}`}
                ref={isActive ? activeRef : undefined}
                className={[
                  styles.lineItem,
                  isActive ? styles.lineActive : '',
                  distance === 1 ? styles.lineNear : '',
                  distance > 3 ? styles.lineFar : '',
                ].filter(Boolean).join(' ')}
                onClick={() => seekToSeconds(line.timeMs / 1000)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    seekToSeconds(line.timeMs / 1000);
                  }
                }}
              >
                {line.text || '\u00a0'}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  // Plain only.
  return (
    <div className={styles.panel} data-mode="plain">
      <div className={styles.head}>
        <Icon name="Music" size={14} />
        <span>Letra</span>
      </div>
      <pre className={styles.plain}>{entry.plain}</pre>
    </div>
  );
}
