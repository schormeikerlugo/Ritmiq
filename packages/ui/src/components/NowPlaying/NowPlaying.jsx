/**
 * Vista fullscreen "Now Playing" estilo Spotify para mobile.
 *
 * - Slide-up animado al abrir, slide-down al cerrar.
 * - Swipe-down en el header cierra la vista.
 * - Background con gradiente del color dominante del cover → bg-0.
 * - Scrubber draggable que llama backend.seek() al soltar.
 * - Controles grandes: shuffle, prev, play/pause (64px), next, repeat.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { useLibraryStore } from '../../stores/library.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { isEphemeralTrack } from '../../lib/track-helpers.js';
import { getDominantColor } from '../../lib/dominant-color.js';
import { Icon } from '../Icon/Icon.jsx';
import { SaveDialog } from '../SaveDialog/SaveDialog.jsx';
import styles from './NowPlaying.module.css';

function fmt(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function NowPlaying() {
  const open = useViewStore((s) => s.nowPlayingOpen);
  const close = useViewStore((s) => s.closeNowPlaying);
  const toggleQueue = useViewStore((s) => s.toggleQueue);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionSeconds = usePlayerStore((s) => s.positionSeconds);
  const durationSeconds = usePlayerStore((s) => s.durationSeconds);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const patch = usePlayerStore((s) => s.patch);

  const isFavorite = usePlaylistsStore((s) => s.isFavorite);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);
  const addTrack = usePlaylistsStore((s) => s.addTrack);
  const toggleFavorite = usePlaylistsStore((s) => s.toggleFavorite);
  const persistEphemeral = useLibraryStore((s) => s.persistEphemeral);

  const [bgColor, setBgColor] = useState('var(--color-bg-1)');
  const [closing, setClosing] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  /** Posición que muestra el scrubber mientras el usuario arrastra. null = no drag. */
  const [scrubPos, setScrubPos] = useState(null);

  const rootRef = useRef(null);
  const dragStateRef = useRef({ startY: 0, currentY: 0, dragging: false });

  // Extraer color dominante cuando cambia la cover.
  useEffect(() => {
    let cancelled = false;
    if (!currentTrack?.coverUrl) {
      setBgColor('var(--color-bg-1)');
      return;
    }
    getDominantColor(currentTrack.coverUrl).then((c) => {
      if (cancelled) return;
      setBgColor(c || 'var(--color-bg-1)');
    });
    return () => { cancelled = true; };
  }, [currentTrack?.coverUrl]);

  // Cerrar con ESC para desktop / teclado físico.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Bloquear scroll del body mientras está abierto.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const ephemeral = currentTrack ? isEphemeralTrack(currentTrack) : false;
  const fav = !!currentTrack && !ephemeral && isFavorite(currentTrack.id);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      close();
    }, 240);
  };

  const onHeart = async () => {
    if (!currentTrack) return;
    let id = currentTrack.id;
    if (ephemeral) {
      const persisted = await persistEphemeral(currentTrack);
      id = persisted.id;
    }
    if (favoritesId && !isFavorite(id)) await addTrack(favoritesId, id);
    else if (favoritesId) await toggleFavorite(id);
  };

  // Swipe-down: usar el header como handle.
  const onTouchStart = (e) => {
    const t = e.touches[0];
    if (!t) return;
    dragStateRef.current = { startY: t.clientY, currentY: t.clientY, dragging: true };
  };
  const onTouchMove = (e) => {
    const t = e.touches[0];
    if (!t || !dragStateRef.current.dragging) return;
    dragStateRef.current.currentY = t.clientY;
    const dy = Math.max(0, t.clientY - dragStateRef.current.startY);
    if (rootRef.current) {
      rootRef.current.style.transform = `translateY(${dy}px)`;
      rootRef.current.style.opacity = String(Math.max(0.5, 1 - dy / 600));
    }
  };
  const onTouchEnd = () => {
    if (!dragStateRef.current.dragging) return;
    const dy = dragStateRef.current.currentY - dragStateRef.current.startY;
    dragStateRef.current.dragging = false;
    if (rootRef.current) {
      rootRef.current.style.transform = '';
      rootRef.current.style.opacity = '';
    }
    if (dy > 100) handleClose();
  };

  // Scrubber: durante el drag, mostrar la posición local; al soltar, llamar seek
  // a través del store con patch (que sincroniza con el backend via use-player).
  const onScrubInput = (e) => {
    setScrubPos(Number(e.target.value));
  };
  const onScrubCommit = (e) => {
    const v = Number(e.target.value);
    setScrubPos(null);
    // Buscar el backend via window event — usamos un evento custom para no
    // crear dep cíclica con use-player. La store mantiene positionSeconds
    // como source of truth visual; el backend.seek lo aplica via el hook.
    patch({ positionSeconds: v });
    window.dispatchEvent(new CustomEvent('ritmiq:seek', { detail: { seconds: v } }));
  };

  const displayPos = scrubPos !== null ? scrubPos : positionSeconds;
  const dur = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;

  const background = useMemo(() => {
    const c = bgColor || 'var(--color-bg-1)';
    return `linear-gradient(180deg, ${c} 0%, var(--color-bg-0) 75%)`;
  }, [bgColor]);

  if (!open && !closing) return null;

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-closing={closing}
      style={{ background }}
      role="dialog"
      aria-label="Reproductor"
    >
      <header
        className={styles.header}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <button className={styles.headerBtn} onClick={handleClose} aria-label="Cerrar">
          <Icon name="ChevronDown" size={24} />
        </button>
        <div className={styles.headerTitle}>
          <span className={styles.eyebrow}>Reproduciendo</span>
          <span className={styles.context}>{currentTrack?.album || currentTrack?.artist || 'Ritmiq'}</span>
        </div>
        <button className={styles.headerBtn} aria-label="Más opciones" onClick={() => setSaveOpen(true)}>
          <Icon name="MoreHorizontal" size={22} />
        </button>
      </header>

      <div className={styles.coverWrap}>
        <div className={styles.cover}>
          {currentTrack?.coverUrl
            ? <img src={currentTrack.coverUrl} alt="" />
            : <div className={styles.coverPlaceholder}><Icon name="Music" size={64} /></div>}
        </div>
      </div>

      <div className={styles.info}>
        <div className={styles.infoText}>
          <h1 className={styles.title}>{currentTrack?.title ?? '—'}</h1>
          <p className={styles.artist}>{currentTrack?.artist ?? '—'}</p>
        </div>
        <button
          className={styles.heartBtn}
          data-active={fav}
          onClick={onHeart}
          aria-label={fav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
        >
          <Icon name="Heart" filled={fav} size={26} />
        </button>
      </div>

      <div className={styles.scrubber}>
        <input
          type="range"
          min={0}
          max={dur || 1}
          step={1}
          value={displayPos}
          onChange={onScrubInput}
          onMouseUp={onScrubCommit}
          onTouchEnd={onScrubCommit}
          onKeyUp={onScrubCommit}
          disabled={!dur}
          aria-label="Posición de la canción"
          className={styles.scrubInput}
          style={{ '--pct': `${dur ? (displayPos / dur) * 100 : 0}%` }}
        />
        <div className={styles.times}>
          <span>{fmt(displayPos)}</span>
          <span>{fmt(dur)}</span>
        </div>
      </div>

      <div className={styles.controls}>
        <button
          className={styles.ctrlBtn}
          data-active={shuffle}
          onClick={toggleShuffle}
          aria-label="Aleatorio"
        >
          <Icon name="Shuffle" size={22} />
        </button>
        <button className={styles.ctrlBtn} onClick={prev} aria-label="Anterior">
          <Icon name="SkipBack" size={32} filled />
        </button>
        <button
          className={styles.playBtn}
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
        >
          <Icon name={isPlaying ? 'Pause' : 'Play'} size={28} filled />
        </button>
        <button className={styles.ctrlBtn} onClick={next} aria-label="Siguiente">
          <Icon name="SkipForward" size={32} filled />
        </button>
        <button
          className={styles.ctrlBtn}
          data-active={repeat !== 'off'}
          onClick={cycleRepeat}
          aria-label="Repetir"
        >
          <Icon name={repeat === 'one' ? 'Repeat1' : 'Repeat'} size={22} />
        </button>
      </div>

      <div className={styles.footer}>
        <button className={styles.footerBtn} aria-label="Dispositivos" disabled>
          <Icon name="Cast" size={20} />
        </button>
        <button
          className={styles.footerBtn}
          onClick={() => { toggleQueue(); handleClose(); }}
          aria-label="Cola"
        >
          <Icon name="ListMusic" size={20} />
        </button>
      </div>

      {saveOpen && currentTrack && (
        <SaveDialog track={currentTrack} onClose={() => setSaveOpen(false)} />
      )}
    </div>
  );
}
