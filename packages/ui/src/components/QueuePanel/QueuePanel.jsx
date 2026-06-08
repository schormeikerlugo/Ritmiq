/**
 * QueuePanel — panel lateral de cola de reproduccion.
 *
 * Tres secciones:
 *   1. "Sonando ahora" — el track actual (sin drag).
 *   2. "A continuacion" — proximos tracks, reordenables con drag.
 *   3. "Reproducidas" — tracks ya escuchados de la cola actual,
 *      colapsado por defecto, sin drag (es historial).
 *
 * Drag-and-drop con @dnd-kit/sortable (mismo patron que PlaylistView).
 *
 * @module @ritmiq/ui/components/QueuePanel
 */
import { useState } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, TouchSensor,
  MouseSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { usePlayerStore } from '../../stores/player.js';
import { useJamStore } from '../../stores/jam.js';
import { toast } from '../../stores/toast.js';
import { Icon } from '../Icon/Icon.jsx';
import { EmptyState } from '../primitives/index.js';
import styles from './QueuePanel.module.css';

function fmtDur(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/** @param {{ onClose: () => void }} props */
export function QueuePanel({ onClose }) {
  // Modo contextual: si hay una jam activa, este panel pasa a ser la cola
  // colaborativa del Jam (sugerencias identificadas). Sin jam, es la cola
  // de reproduccion normal.
  const jamMode = useJamStore((s) => s.mode);
  if (jamMode !== 'idle') {
    return <JamQueueView onClose={onClose} />;
  }
  return <LocalQueueView onClose={onClose} />;
}

/** Cola de reproduccion local (comportamiento original, sin jam). */
function LocalQueueView({ onClose }) {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const moveQueueItem = usePlayerStore((s) => s.moveQueueItem);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const [showHistory, setShowHistory] = useState(false);

  // Sensores separados por device para evitar conflictos:
  //   - Mouse (desktop): distance 4px → snappy, no espera.
  //   - Touch (mobile):  delay 220ms + tolerance 6px → distingue tap/scroll
  //     del drag. Sin delay, cualquier scroll vertical iniciaria un drag y
  //     bloquearia el scroll de la pagina.
  //   - Keyboard: navegacion accesible.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const current = index >= 0 ? queue[index] : null;
  const upcoming = queue.slice(index + 1);
  const played = index > 0 ? queue.slice(0, index) : [];

  // Keys estables para upcoming — combinan id + posicion real en la cola
  // para evitar colision si el mismo track esta dos veces en la cola.
  const upcomingItems = upcoming.map((t, i) => ({
    track: t,
    realIdx: index + 1 + i,
    dndId: `q-${index + 1 + i}-${t.id}`,
  }));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldOrderIdx = upcomingItems.findIndex((it) => it.dndId === active.id);
    const newOrderIdx = upcomingItems.findIndex((it) => it.dndId === over.id);
    if (oldOrderIdx < 0 || newOrderIdx < 0) return;
    const fromIdx = upcomingItems[oldOrderIdx].realIdx;
    const toIdx = upcomingItems[newOrderIdx].realIdx;
    moveQueueItem(fromIdx, toIdx);
  };

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
        <EmptyState
          icon="ListMusic"
          title="La cola está vacía"
          subtitle="Reproduce una playlist o añade canciones desde el menú de cada track."
          size="sm"
        />
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
                    // "Vaciar" — mantiene solo el track actual.
                    const cur = usePlayerStore.getState().currentTrack;
                    if (cur) usePlayerStore.getState().playNow(cur);
                    else clearQueue();
                  }}
                >Vaciar</button>
              )}
            </div>
            {upcoming.length === 0 ? (
              <p className={styles.muted}>Sin más canciones encoladas.</p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={upcomingItems.map((it) => it.dndId)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className={styles.list}>
                    {upcomingItems.map((it) => (
                      <SortableRow
                        key={it.dndId}
                        dndId={it.dndId}
                        track={it.track}
                        onClick={() => {
                          usePlayerStore.setState({
                            index: it.realIdx,
                            currentTrack: it.track,
                            isPlaying: true,
                            positionSeconds: 0,
                          });
                        }}
                        onRemove={() => removeFromQueue(it.realIdx)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
          </section>

          {played.length > 0 && (
            <section className={styles.section}>
              <button
                type="button"
                className={styles.collapseHead}
                onClick={() => setShowHistory((v) => !v)}
                aria-expanded={showHistory}
              >
                <span className={styles.sectionTitle}>
                  Reproducidas ({played.length})
                </span>
                <Icon
                  name={showHistory ? 'ChevronUp' : 'ChevronDown'}
                  size={16}
                />
              </button>
              {showHistory && (
                <ul className={styles.list}>
                  {played.map((t, i) => (
                    <li key={`played-${i}-${t.id}`} className={styles.li}>
                      <Row
                        track={t}
                        muted
                        onClick={() => {
                          usePlayerStore.setState({
                            index: i,
                            currentTrack: t,
                            isPlaying: true,
                            positionSeconds: 0,
                          });
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </aside>
  );
}

/**
 * Fila ordenable via dnd-kit. Usada solo en "A continuacion".
 *
 * Listeners de drag montados en TODA la fila (no solo en el handle) — en
 * mobile el handle es muy pequeno para ser tap target unico. El TouchSensor
 * con delay 220ms ya distingue tap/scroll de drag, asi que iniciar drag
 * desde cualquier punto de la fila es seguro.
 *
 * El handle queda como affordance visual (muestra al usuario que la fila
 * es reordenable) y como zona de inicio de drag en desktop (mouse).
 */
function SortableRow({ dndId, track, onClick, onRemove }) {
  const sortable = useSortable({ id: dndId });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.55 : 1,
    zIndex: sortable.isDragging ? 2 : undefined,
  };
  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className={styles.li}
      data-dragging={sortable.isDragging || undefined}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <div className={styles.dragHandle} aria-hidden="true">
        <Icon name="Menu" size={14} />
      </div>
      <Row
        track={track}
        onClick={onClick}
        onRemove={onRemove}
        dragging={sortable.isDragging}
      />
    </li>
  );
}

function Row({ track, playing, muted, dragging, onClick, onRemove }) {
  // Si la fila esta siendo arrastrada, el click NO debe disparar play
  // (el usuario solo queria reordenar). dnd-kit ya hace cancel del click
  // tras un drag exitoso, pero con touch a veces el click se cuela.
  const handleClick = (e) => {
    if (dragging) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <div
      className={styles.row}
      data-playing={!!playing}
      data-muted={!!muted}
    >
      <button
        className={styles.cell}
        onClick={handleClick}
        aria-label={`Reproducir ${track.title}`}
      >
        <div className={styles.thumb}>
          {track.coverUrl
            ? <img src={track.coverUrl} alt="" loading="lazy" />
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
          onClick={(e) => { e.stopPropagation(); onRemove(e); }}
          aria-label="Quitar de la cola"
          title="Quitar"
        ><Icon name="X" size={16} /></button>
      )}
    </div>
  );
}

// ── Modo Jam: cola colaborativa de sugerencias ────────────────────────────

/** Nombre visible de un perfil (display_name > @username > id corto). */
function profileLabel(profile, userId) {
  if (profile?.displayName) return profile.displayName;
  if (profile?.username) return '@' + profile.username;
  return userId ? userId.slice(0, 6) : 'Alguien';
}

/**
 * Vista de la cola colaborativa del Jam. Reemplaza la cola local mientras
 * hay una jam activa. Cualquier participante ve la lista con el avatar +
 * nombre de quien sugirio cada cancion. Solo el host reproduce / quita /
 * (los guests solo pueden quitar SUS sugerencias no reproducidas).
 */
function JamQueueView({ onClose }) {
  const mode = useJamStore((s) => s.mode);
  const session = useJamStore((s) => s.session);
  const suggestions = useJamStore((s) => s.suggestions);
  const profilesById = useJamStore((s) => s.profilesById);
  const jamState = useJamStore((s) => s.state);
  const playSuggestion = useJamStore((s) => s.playSuggestion);
  const removeSuggestion = useJamStore((s) => s.removeSuggestion);

  const isHost = mode === 'hosting';
  const myId = session?.hostId && isHost ? session.hostId : null;

  const pending = suggestions.filter((s) => !s.playedAt);
  const played = suggestions.filter((s) => s.playedAt);
  const nowPlaying = jamState?.currentTrack ?? null;

  const handlePlay = (item) => {
    if (!isHost) {
      toast.info('El host controla la reproducción');
      return;
    }
    playSuggestion(item.id).catch((e) => toast.error(String(e?.message ?? e)));
  };

  const handleRemove = (item) => {
    removeSuggestion(item.id).catch((e) => toast.error(String(e?.message ?? e)));
  };

  // Un item es quitable por el viewer si es host, o si es el autor y no se
  // reprodujo. (myId solo lo conocemos con certeza para el host; para el
  // guest la RLS valida igualmente y el boton se muestra optimista.)
  const canRemove = (item) => isHost || (!item.playedAt);

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>
          <Icon name="Radio" size={16} /> Cola del Jam
        </h2>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Cerrar panel"
        ><Icon name="X" size={20} /></button>
      </header>

      {nowPlaying && (
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Sonando ahora</div>
          <JamRow
            track={nowPlaying}
            profile={null}
            userId={null}
            playing
          />
        </section>
      )}

      <section className={styles.section}>
        <span className={styles.sectionTitle}>
          Sugerencias ({pending.length})
        </span>
        {pending.length === 0 ? (
          <p className={styles.muted}>
            Aún no hay sugerencias. Usa “Sugerir a la jam” desde cualquier canción.
          </p>
        ) : (
          <ul className={styles.list}>
            {pending.map((item) => (
              <li key={item.id} className={styles.li}>
                <JamRow
                  track={item.track}
                  profile={profilesById[item.suggestedBy]}
                  userId={item.suggestedBy}
                  canPlay={isHost}
                  onPlay={() => handlePlay(item)}
                  onRemove={canRemove(item) ? () => handleRemove(item) : undefined}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {played.length > 0 && (
        <section className={styles.section}>
          <span className={styles.sectionTitle}>
            Reproducidas ({played.length})
          </span>
          <ul className={styles.list}>
            {played.map((item) => (
              <li key={item.id} className={styles.li}>
                <JamRow
                  track={item.track}
                  profile={profilesById[item.suggestedBy]}
                  userId={item.suggestedBy}
                  muted
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

/**
 * Fila de la cola del Jam: cover + título/artista + chip del sugeridor
 * (avatar o inicial + nombre). El host ve play; quien puede, ve quitar.
 */
function JamRow({ track, profile, userId, playing, muted, canPlay, onPlay, onRemove }) {
  const label = userId ? profileLabel(profile, userId) : null;
  const avatar = profile?.avatarUrl;
  return (
    <div
      className={styles.row}
      data-playing={!!playing}
      data-muted={!!muted}
    >
      <button
        className={styles.cell}
        onClick={canPlay ? onPlay : undefined}
        disabled={!canPlay}
        aria-label={canPlay ? `Reproducir ${track.title}` : track.title}
      >
        <div className={styles.thumb}>
          {track.coverUrl
            ? <img src={track.coverUrl} alt="" loading="lazy" />
            : <Icon name="Music" size={18} />}
        </div>
        <div className={styles.meta}>
          <span className={styles.rowTitle}>{track.title}</span>
          <span className={styles.rowArtist}>{track.artist ?? '—'}</span>
          {label && (
            <span className={styles.suggestedBy}>
              <span className={styles.suggesterAvatar} aria-hidden="true">
                {avatar
                  ? <img src={avatar} alt="" loading="lazy" />
                  : <Icon name="User" size={10} />}
              </span>
              {label}
            </span>
          )}
        </div>
      </button>
      <span className={styles.dur}>{fmtDur(track.durationSeconds)}</span>
      {onRemove && (
        <button
          className={styles.removeBtn}
          onClick={(e) => { e.stopPropagation(); onRemove(e); }}
          aria-label="Quitar sugerencia"
          title="Quitar"
        ><Icon name="X" size={16} /></button>
      )}
    </div>
  );
}
