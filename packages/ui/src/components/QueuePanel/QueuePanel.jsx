import { usePlayerStore } from '../../stores/player.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './QueuePanel.module.css';

function fmtDur(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/** @param {{ onClose: () => void }} props */
export function QueuePanel({ onClose }) {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const playNow = usePlayerStore((s) => s.playNow);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);

  const current = index >= 0 ? queue[index] : null;
  const upcoming = queue.slice(index + 1);

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>Cola de reproducción</h2>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Cerrar panel"
        ><Icon name="X" size={20} /></button>
      </header>

      {queue.length === 0 ? (
        <div className={styles.empty}>
          <p>La cola está vacía.</p>
          <p className={styles.emptyHint}>
            Reproduce una playlist o añade canciones desde el menú.
          </p>
        </div>
      ) : (
        <>
          {current && (
            <section className={styles.section}>
              <div className={styles.sectionTitle}>Sonando ahora</div>
              <Row track={current} playing onClick={() => {}} />
            </section>
          )}

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>
                A continuación ({upcoming.length})
              </span>
              {upcoming.length > 0 && (
                <button
                  className={styles.linkBtn}
                  onClick={() => {
                    if (current) playNow(current);
                    else clearQueue();
                  }}
                >Vaciar</button>
              )}
            </div>
            {upcoming.length === 0 ? (
              <p className={styles.muted}>Sin más canciones encoladas.</p>
            ) : (
              <ul className={styles.list}>
                {upcoming.map((t, i) => {
                  const realIdx = index + 1 + i;
                  return (
                    <li key={`${t.id}-${realIdx}`} className={styles.li}>
                      <Row
                        track={t}
                        onClick={() => {
                          usePlayerStore.setState({
                            index: realIdx,
                            currentTrack: t,
                            isPlaying: true,
                            positionSeconds: 0,
                          });
                        }}
                        onRemove={() => removeFromQueue(realIdx)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </aside>
  );
}

function Row({ track, playing, onClick, onRemove }) {
  return (
    <div className={styles.row} data-playing={!!playing}>
      <button
        className={styles.cell}
        onClick={onClick}
        aria-label={`Reproducir ${track.title}`}
      >
        <div className={styles.thumb}>
          {track.coverUrl
            ? <img src={track.coverUrl} alt="" />
            : <Icon name="Music" size={18} />}
        </div>
        <div className={styles.meta}>
          <span className={styles.rowTitle}>{track.title}</span>
          <span className={styles.rowArtist}>{track.artist ?? '—'}</span>
        </div>
      </button>
      <span className={styles.dur}>{fmtDur(track.durationSeconds)}</span>
      {onRemove && (
        <button
          className={styles.removeBtn}
          onClick={onRemove}
          aria-label="Quitar de la cola"
          title="Quitar"
        ><Icon name="X" size={16} /></button>
      )}
    </div>
  );
}
