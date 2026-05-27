/**
 * ShareToFriendModal — modal para compartir un track o playlist con amigos.
 *
 * Acepta `track` O `playlist` (mutuamente excluyentes).
 * Muestra la lista de amigos mutuos. El usuario puede seleccionar uno o
 * varios y anadir un mensaje opcional (max 280 chars).
 *
 * Llama a useSocialStore.sendShare() via Edge Function send-share.
 *
 * @param {{ track?: Track, playlist?: PlaylistShare, onClose: () => void }} props
 * @typedef {{ id:string, name:string, coverUrl:string|null, tracks: object[] }} PlaylistShare
 */

import { useState } from 'react';
import { Modal } from '../Modal/Modal.jsx';
import { useSocialStore } from '../../stores/social.js';
import { Icon } from '../Icon/Icon.jsx';
import { Button, FormError } from '../primitives/index.js';
import { hapticSuccess, hapticError } from '../../lib/haptics.js';
import styles from './ShareToFriendModal.module.css';

export function ShareToFriendModal({ track, playlist, onClose }) {
  const isPlaylist = !!playlist && !track;
  const friends  = useSocialStore((s) => s.friends);
  const [selected, setSelected] = useState(new Set());
  const [message, setMessage]   = useState('');
  const [sending, setSending]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [error, setError]       = useState(null);

  function toggleFriend(userId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleSend() {
    if (selected.size === 0 || sending) return;
    setSending(true);
    setError(null);

    const payload = isPlaylist
      ? {
          kind:             'playlist',
          playlistName:     playlist.name,
          playlistSnapshot: { tracks: playlist.tracks },
          message:          message.trim() || null,
        }
      : {
          kind:            'track',
          ytId:            track.ytId ?? track.yt_id,
          title:           track.title ?? null,
          artist:          track.artist ?? null,
          coverUrl:        track.coverUrl ?? track.cover_url ?? null,
          durationSeconds: track.durationSeconds ?? track.duration_seconds ?? null,
          message:         message.trim() || null,
        };

    const errors = [];
    await Promise.all(
      [...selected].map(async (receiverId) => {
        try {
          await useSocialStore.getState().sendShare({ ...payload, receiverId });
        } catch (e) {
          errors.push(e.message);
        }
      }),
    );

    setSending(false);
    if (errors.length > 0) {
      // Haptic error pattern \u2014 Android, no-op iOS.
      hapticError();
      setError(`Error al enviar a ${errors.length} amigo(s)`);
    } else {
      // Haptic success \u2014 pulsos cortos crecientes para confirmar
      // que el share llego. Refuerza la sensacion nativa.
      hapticSuccess();
      setSent(true);
      setTimeout(onClose, 1500);
    }
  }

  if (friends.length === 0) {
    return (
      <Modal onClose={onClose} title="Compartir con amigo" size="sm">
        <div className={styles.empty}>
          <Icon name="Users" size={36} />
          <p>No tienes amigos en Ritmiq aun.</p>
          <p className={styles.emptySub}>Agrega amigos desde la seccion Amigos.</p>
        </div>
      </Modal>
    );
  }

  // Estado dinamico del Button submit
  const sendLabel = sent
    ? (<><Icon name="Check" size={14} /> Enviado</>)
    : (<><Icon name="Send" size={14} /> Enviar{selected.size > 1 ? ` (${selected.size})` : ''}</>);

  return (
    <Modal
      onClose={onClose}
      title={isPlaylist ? 'Compartir playlist con amigo' : 'Compartir con amigo'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={sending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSend}
            loading={sending}
            loadingText="Enviando..."
            disabled={selected.size === 0 || sent}
          >
            {sendLabel}
          </Button>
        </>
      }
    >
      {/* Preview del item */}
      <div className={styles.trackPreview}>
        {(isPlaylist ? playlist.coverUrl : (track.coverUrl ?? track.cover_url)) ? (
          <img
            src={isPlaylist ? playlist.coverUrl : (track.coverUrl ?? track.cover_url)}
            alt=""
            className={styles.trackCover}
          />
        ) : (
          <div className={styles.trackCoverFallback}>
            <Icon name={isPlaylist ? 'ListMusic' : 'Music'} size={20} />
          </div>
        )}
        <div className={styles.trackMeta}>
          <span className={styles.trackTitle}>
            {isPlaylist ? playlist.name : (track.title ?? 'Track')}
          </span>
          {isPlaylist && (
            <span className={styles.trackArtist}>{playlist.tracks.length} tracks</span>
          )}
          {!isPlaylist && track.artist && (
            <span className={styles.trackArtist}>{track.artist}</span>
          )}
        </div>
      </div>

      {/* Lista de amigos */}
      <p className={styles.label}>Enviar a:</p>
      <ul className={styles.friendList}>
        {friends.map((f) => (
          <li
            key={f.userId}
            className={styles.friendRow}
            data-selected={selected.has(f.userId)}
            onClick={() => toggleFriend(f.userId)}
          >
            <FriendAvatar friend={f} />
            <div className={styles.friendInfo}>
              <span className={styles.friendName}>{f.displayName ?? f.username}</span>
              <span className={styles.friendHandle}>@{f.username}</span>
            </div>
            <span className={styles.check}>
              {selected.has(f.userId)
                ? <Icon name="CheckCircle2" size={18} />
                : <Icon name="Circle" size={18} />}
            </span>
          </li>
        ))}
      </ul>

      {/* Mensaje opcional — destacado para invitar a personalizar el share */}
      <div className={styles.messageBox}>
        <label className={styles.messageLabel}>
          <Icon name="MessageCircle" size={13} />
          <span>Tu mensaje</span>
          <span className={styles.messageHint}>recomendado</span>
        </label>
        <textarea
          className={styles.messageInput}
          placeholder="Escucha esto, te va a encantar..."
          maxLength={280}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
        />
        <span className={styles.charCount}>{message.length}/280</span>
      </div>

      <FormError onDismiss={() => setError(null)}>{error}</FormError>
    </Modal>
  );
}

function FriendAvatar({ friend }) {
  if (friend.avatarUrl) {
    return <img src={friend.avatarUrl} alt="" className={styles.avatar} loading="lazy" />;
  }
  const initial = (friend.displayName ?? friend.username ?? '?').slice(0, 1).toUpperCase();
  return <span className={styles.avatarInitial}>{initial}</span>;
}
