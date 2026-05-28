import { useState, useRef, useCallback } from 'react';
import { usePlayerStore } from '../../stores/player.js';
import { useLibraryStore } from '../../stores/library.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { useViewStore } from '../../stores/view.js';
import { isEphemeralTrack } from '../../lib/track-helpers.js';
import { SaveDialog } from '../SaveDialog/SaveDialog.jsx';
import { ShareToFriendModal } from '../ShareToFriendModal/ShareToFriendModal.jsx';
import { Icon } from '../Icon/Icon.jsx';
import { CoverArt } from '../primitives/CoverArt.jsx';
import { hapticTap } from '../../lib/haptics.js';
import styles from './Player.module.css';

function fmt(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function Player() {
  const { currentTrack, isPlaying, positionSeconds, durationSeconds, volume,
          shuffle, repeat, error, togglePlay, setVolume, toggleShuffle,
          cycleRepeat, next, prev } =
    usePlayerStore();

  const tracks = useLibraryStore((s) => s.tracks);
  const persistEphemeral = useLibraryStore((s) => s.persistEphemeral);
  const toggleFavorite = usePlaylistsStore((s) => s.toggleFavorite);
  const isFavorite = usePlaylistsStore((s) => s.isFavorite);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);
  const addTrack = usePlaylistsStore((s) => s.addTrack);
  const openNowPlaying = useViewStore((s) => s.openNowPlaying);

  const [saveOpen, setSaveOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Estado de scrub: cuando el usuario esta arrastrando, mostramos su
  // posicion tentativa en vez del positionSeconds real, asi la UI no
  // "salta hacia atras" entre el render del drag y el commit del seek.
  const [scrubPos, setScrubPos] = useState(null);
  const barRef = useRef(null);
  const draggingRef = useRef(false);

  const effectivePos = scrubPos != null ? scrubPos : positionSeconds;
  const progress = durationSeconds
    ? Math.max(0, Math.min(100, (effectivePos / durationSeconds) * 100))
    : 0;

  /* ── Seek por click/drag en la barra de progreso ────────────────────
   * Antes el `<div className={styles.bar}>` solo tenia `cursor: pointer`
   * pero ningun handler — el click no hacia nada ni en PWA ni en Electron.
   * Usamos pointer events (cubren mouse + touch + pen en una sola API)
   * con setPointerCapture para que el drag fuera de la barra siga
   * actualizando posicion. El seek real se dispara via el mismo evento
   * `ritmiq:seek` que ya consume use-player.js -> backend.seek(). */
  const computeSecondsFromEvent = useCallback(
    (clientX) => {
      const el = barRef.current;
      if (!el || !durationSeconds) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * durationSeconds;
    },
    [durationSeconds],
  );

  const commitSeek = useCallback((sec) => {
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return;
    window.dispatchEvent(
      new CustomEvent('ritmiq:seek', { detail: { seconds: sec } }),
    );
  }, []);

  const onBarPointerDown = useCallback(
    (e) => {
      if (!currentTrack || !durationSeconds) return;
      // Solo boton primario para mouse; touch/pen siempre OK.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const sec = computeSecondsFromEvent(e.clientX);
      if (sec == null) return;
      draggingRef.current = true;
      setScrubPos(sec);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* navegadores raros — seguimos sin capture */
      }
      e.preventDefault();
    },
    [currentTrack, durationSeconds, computeSecondsFromEvent],
  );

  const onBarPointerMove = useCallback(
    (e) => {
      if (!draggingRef.current) return;
      const sec = computeSecondsFromEvent(e.clientX);
      if (sec != null) setScrubPos(sec);
    },
    [computeSecondsFromEvent],
  );

  const onBarPointerEnd = useCallback(
    (e) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const sec = computeSecondsFromEvent(e.clientX);
      const finalSec = sec != null ? sec : scrubPos;
      setScrubPos(null);
      commitSeek(finalSec);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    },
    [computeSecondsFromEvent, scrubPos, commitSeek],
  );

  // Accesibilidad: ←/→ mueven 5s, Shift+←/→ mueven 15s, Home/End saltan a 0/dur.
  const onBarKeyDown = useCallback(
    (e) => {
      if (!currentTrack || !durationSeconds) return;
      const step = e.shiftKey ? 15 : 5;
      let next = positionSeconds;
      if (e.key === 'ArrowRight') next = positionSeconds + step;
      else if (e.key === 'ArrowLeft') next = positionSeconds - step;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = durationSeconds;
      else return;
      e.preventDefault();
      next = Math.max(0, Math.min(durationSeconds, next));
      commitSeek(next);
    },
    [currentTrack, durationSeconds, positionSeconds, commitSeek],
  );
  const ephemeral = currentTrack ? isEphemeralTrack(currentTrack) : false;
  const inLibrary = !!currentTrack && !ephemeral &&
                    tracks.some((t) => t.id === currentTrack.id);
  const fav = !!currentTrack && !ephemeral && isFavorite(currentTrack.id);

  const onHeart = async (e) => {
    e?.stopPropagation();
    if (!currentTrack) return;
    // Haptic confirmacion en Android \u2014 hace que el like se sienta
    // tangible. iOS no-op (Apple no expone haptics a Web).
    hapticTap();
    let id = currentTrack.id;
    if (ephemeral) {
      const persisted = await persistEphemeral(currentTrack);
      id = persisted.id;
    }
    if (favoritesId && !isFavorite(id)) {
      await addTrack(favoritesId, id);
    } else if (favoritesId) {
      await toggleFavorite(id);
    }
  };

  const onPlus = (e) => {
    e?.stopPropagation();
    if (!currentTrack) return;
    setSaveOpen(true);
  };

  const onShare = (e) => {
    e?.stopPropagation();
    if (!currentTrack) return;
    hapticTap();
    setShareOpen(true);
  };

  // Tap en la zona del cover/meta en mobile → abrir NowPlaying.
  const onExpand = () => {
    if (!currentTrack) return;
    openNowPlaying();
  };

  return (
    <div className={styles.player} data-empty={!currentTrack}>
      {/* Barra fina superior de progreso, visible solo en mobile (CSS). */}
      <div className={styles.miniProgress} aria-hidden="true">
        <div className={styles.miniProgressFill} style={{ width: `${progress}%` }} />
      </div>

      <div className={styles.left}>
        <button
          type="button"
          className={styles.now}
          onClick={onExpand}
          aria-label={currentTrack ? `Ver ${currentTrack.title} a pantalla completa` : 'Reproductor'}
          disabled={!currentTrack}
        >
          <div
            className={styles.cover}
            data-has-cover={!!currentTrack?.coverUrl}
            data-spinning={isPlaying && !!currentTrack?.coverUrl}
            aria-hidden="true"
          >
            <CoverArt
              coverUrl={currentTrack?.coverUrl}
              seed={currentTrack?.title || currentTrack?.artist || 'ritmiq'}
              radius="sm"
              initials={!!currentTrack}
            />
          </div>
          <div className={styles.meta}>
            <div className={styles.title}>
              {currentTrack?.title ?? 'Nada en reproducción'}
            </div>
            <div className={styles.artist}>
              {currentTrack?.artist ?? '—'}
            </div>
          </div>
        </button>

        {currentTrack && (
          <div className={styles.trackActions}>
            <button
              className={styles.iconBtn}
              data-active={fav}
              data-heart="true"
              onClick={onHeart}
              aria-label={fav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
              title={fav ? 'En favoritos' : 'Favoritar'}
            >
              <Icon name="Heart" filled={fav} size={18} />
            </button>
            <button
              className={styles.iconBtn}
              onClick={onPlus}
              aria-label="Guardar en biblioteca o playlist"
              title={inLibrary ? 'Añadir a playlist…' : 'Guardar…'}
            >
              <Icon name="Plus" size={18} />
            </button>
            <button
              className={styles.iconBtn}
              onClick={onShare}
              aria-label="Compartir con un amigo"
              title="Compartir con un amigo"
            >
              <Icon name="Share2" size={18} />
            </button>
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.buttons}>
          <button
            className={styles.iconBtn}
            data-active={shuffle}
            onClick={toggleShuffle}
            aria-label="Aleatorio"
          ><Icon name="Shuffle" size={18} /></button>
          <button className={styles.iconBtn} onClick={prev} aria-label="Anterior">
            <Icon name="SkipBack" size={20} filled />
          </button>
          <button
            className={styles.playBtn}
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          >
            <Icon name={isPlaying ? 'Pause' : 'Play'} size={18} filled />
          </button>
          <button className={styles.iconBtn} onClick={next} aria-label="Siguiente">
            <Icon name="SkipForward" size={20} filled />
          </button>
          <button
            className={styles.iconBtn}
            data-active={repeat !== 'off'}
            onClick={cycleRepeat}
            aria-label="Repetir"
          ><Icon name={repeat === 'one' ? 'Repeat1' : 'Repeat'} size={18} /></button>
        </div>
        <div className={styles.progress}>
          <span className={styles.time}>{fmt(effectivePos)}</span>
          <div
            ref={barRef}
            className={styles.bar}
            role="slider"
            tabIndex={currentTrack ? 0 : -1}
            aria-label="Posicion de la cancion"
            aria-valuemin={0}
            aria-valuemax={durationSeconds || 0}
            aria-valuenow={Math.floor(effectivePos)}
            aria-valuetext={`${fmt(effectivePos)} de ${fmt(durationSeconds)}`}
            aria-disabled={!currentTrack || !durationSeconds}
            data-scrubbing={scrubPos != null || undefined}
            onPointerDown={onBarPointerDown}
            onPointerMove={onBarPointerMove}
            onPointerUp={onBarPointerEnd}
            onPointerCancel={onBarPointerEnd}
            onKeyDown={onBarKeyDown}
          >
            <div className={styles.barFill} style={{ width: `${progress}%` }}>
              <span className={styles.barThumb} aria-hidden="true" />
            </div>
          </div>
          <span className={styles.time}>{fmt(durationSeconds)}</span>
        </div>
      </div>

      <div className={styles.right}>
        <QueueToggle />
        <span className={styles.volIcon} aria-hidden="true">
          <Icon name={volume === 0 ? 'VolumeX' : 'Volume2'} size={16} />
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className={styles.volume}
          aria-label="Volumen"
        />
      </div>

      {/* En mobile, único botón visible junto al meta: play/pause grande */}
      <button
        className={styles.mobilePlay}
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
      >
        <Icon name={isPlaying ? 'Pause' : 'Play'} size={22} filled />
      </button>

      {error && (
        <div className={styles.errorToast} role="alert">
          <Icon name="AlertTriangle" size="sm" />
          <span className={styles.errorMsg}>No se pudo reproducir: {error}</span>
          <button
            type="button"
            className={styles.errorAction}
            onClick={() => {
              usePlayerStore.setState({ error: null });
              // Reintenta forzando re-load del track actual.
              if (currentTrack) usePlayerStore.getState().playNow([currentTrack], 0);
            }}
            aria-label="Reintentar"
          >Reintentar</button>
          <button
            type="button"
            className={styles.errorClose}
            onClick={() => usePlayerStore.setState({ error: null })}
            aria-label="Cerrar"
          ><Icon name="X" size="sm" /></button>
        </div>
      )}

      {saveOpen && currentTrack && (
        <SaveDialog
          track={currentTrack}
          onClose={() => setSaveOpen(false)}
        />
      )}
      {shareOpen && currentTrack && (
        <ShareToFriendModal
          track={currentTrack}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

function QueueToggle() {
  const queueOpen = useViewStore((s) => s.queueOpen);
  const toggleQueue = useViewStore((s) => s.toggleQueue);
  const queueLength = usePlayerStore((s) => s.queue.length);
  return (
    <button
      className={styles.iconBtn}
      data-active={queueOpen}
      onClick={toggleQueue}
      aria-label={queueOpen ? 'Cerrar cola' : 'Abrir cola'}
      title="Cola de reproducción"
    >
      <Icon name="ListMusic" size={18} />
      {queueLength > 0 && <span className={styles.queueBadge}>{queueLength}</span>}
    </button>
  );
}
