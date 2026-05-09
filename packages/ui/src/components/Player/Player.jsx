import { useState } from 'react';
import { usePlayerStore } from '../../stores/player.js';
import { useLibraryStore } from '../../stores/library.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { useViewStore } from '../../stores/view.js';
import { isEphemeralTrack } from '../../lib/track-helpers.js';
import { SaveDialog } from '../SaveDialog/SaveDialog.jsx';
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

  const [saveOpen, setSaveOpen] = useState(false);

  const progress = durationSeconds ? (positionSeconds / durationSeconds) * 100 : 0;
  const ephemeral = currentTrack ? isEphemeralTrack(currentTrack) : false;
  const inLibrary = !!currentTrack && !ephemeral &&
                    tracks.some((t) => t.id === currentTrack.id);
  const fav = !!currentTrack && !ephemeral && isFavorite(currentTrack.id);

  const onHeart = async () => {
    if (!currentTrack) return;
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

  const onPlus = () => {
    if (!currentTrack) return;
    setSaveOpen(true);
  };

  return (
    <div className={styles.player}>
      <div className={styles.now}>
        <div className={styles.cover} aria-hidden="true">
          {currentTrack?.coverUrl
            ? <img src={currentTrack.coverUrl} alt="" />
            : <div className={styles.coverPlaceholder}>♫</div>}
        </div>
        <div className={styles.meta}>
          <div className={styles.title}>
            {currentTrack?.title ?? 'Nada en reproducción'}
          </div>
          <div className={styles.artist}>
            {currentTrack?.artist ?? '—'}
          </div>
        </div>
        {currentTrack && (
          <div className={styles.trackActions}>
            <button
              className={styles.iconBtn}
              data-active={fav}
              data-heart="true"
              onClick={onHeart}
              aria-label={fav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
              title={fav ? 'En favoritos' : 'Favoritar'}
            >{fav ? '♥' : '♡'}</button>
            <button
              className={styles.iconBtn}
              onClick={onPlus}
              aria-label="Guardar en biblioteca o playlist"
              title={inLibrary ? 'Añadir a playlist…' : 'Guardar…'}
            >＋</button>
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
          >⇄</button>
          <button className={styles.iconBtn} onClick={prev} aria-label="Anterior">⏮</button>
          <button
            className={styles.playBtn}
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          >{isPlaying ? '❚❚' : '▶'}</button>
          <button className={styles.iconBtn} onClick={next} aria-label="Siguiente">⏭</button>
          <button
            className={styles.iconBtn}
            data-active={repeat !== 'off'}
            onClick={cycleRepeat}
            aria-label="Repetir"
          >{repeat === 'one' ? '↻¹' : '↻'}</button>
        </div>
        <div className={styles.progress}>
          <span className={styles.time}>{fmt(positionSeconds)}</span>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${progress}%` }} />
          </div>
          <span className={styles.time}>{fmt(durationSeconds)}</span>
        </div>
      </div>

      <div className={styles.right}>
        <QueueToggle />
        <span className={styles.volIcon} aria-hidden="true">🔊</span>
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

      {error && (
        <div
          className={styles.errorToast}
          onClick={() => usePlayerStore.setState({ error: null })}
          role="alert"
        >
          ⚠ No se pudo reproducir: {error}
        </div>
      )}

      {saveOpen && currentTrack && (
        <SaveDialog
          track={currentTrack}
          onClose={() => setSaveOpen(false)}
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
      <span aria-hidden="true">☰</span>
      {queueLength > 0 && <span className={styles.queueBadge}>{queueLength}</span>}
    </button>
  );
}
