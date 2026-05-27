/**
 * ShareReminderModal — recordatorio amable de shares no vistos.
 *
 * Aparece cuando el hook useShareReminder detecta items en el inbox que
 * llevan >2 min sin abrirse. Suspende lo que esta haciendo el usuario
 * con un modal centrado que muestra hasta 3 recordatorios y dos CTAs:
 *
 *   "Ver bandeja"  → navega a Amigos → tab Compartido
 *   "Ahora no"     → cierra el modal (no vuelve a aparecer para esos items)
 *
 * Si el usuario hace click en un item especifico, lo reproduce
 * directamente Y marca como leido. Util para los que solo quieren
 * escuchar y seguir.
 *
 * @module @ritmiq/ui/components/ShareReminder/ShareReminderModal
 */

import { Modal } from '../Modal/Modal.jsx';
import { Icon } from '../Icon/Icon.jsx';
import { Button } from '../primitives/index.js';
import { useShareReminderStore } from '../../lib/use-share-reminder.js';
import { useSocialStore } from '../../stores/social.js';
import { useViewStore } from '../../stores/view.js';
import { usePlayerStore } from '../../stores/player.js';
import styles from './ShareReminderModal.module.css';

export function ShareReminderModal() {
  const items   = useShareReminderStore((s) => s.pendingReminders);
  const dismiss = useShareReminderStore((s) => s.dismiss);

  if (!items || items.length === 0) return null;

  const isPlural = items.length > 1;

  function handleSeeInbox() {
    useViewStore.getState().goFriends();
    dismiss();
  }

  function handlePlayItem(item) {
    useSocialStore.getState().markInboxItemRead(item.id);
    // id con prefix 'yt:' \u2014 imprescindible para que isEphemeralTrack()
    // lo reconozca y el Player permita Like / Anadir a playlist
    // (persistEphemeral primero genera un UUID real). Ver el mismo
    // patron en FriendsView InboxTab.handlePlay.
    if (item.kind === 'track' && item.ytId) {
      usePlayerStore.getState().playNow({
        id:              `yt:${item.ytId}`,
        ytId:            item.ytId,
        yt_id:           item.ytId,
        title:           item.title ?? 'Track compartido',
        artist:          item.artist ?? '',
        coverUrl:        item.coverUrl,
        cover_url:       item.coverUrl,
        durationSeconds: item.durationSeconds,
        source:          'youtube',
        createdAt:       new Date().toISOString(),
      });
    } else if (item.kind === 'playlist' && item.playlistSnapshot?.tracks?.length) {
      const tracks = item.playlistSnapshot.tracks.map((t) => ({
        id:              `yt:${t.ytId}`,
        ytId:            t.ytId,
        yt_id:           t.ytId,
        title:           t.title ?? '',
        artist:          t.artist ?? '',
        coverUrl:        t.coverUrl,
        cover_url:       t.coverUrl,
        durationSeconds: t.durationSeconds,
        source:          'youtube',
        createdAt:       new Date().toISOString(),
      }));
      usePlayerStore.getState().playNow(tracks);
    }
    dismiss();
  }

  return (
    <Modal
      onClose={dismiss}
      title={isPlural ? 'Tienes música pendiente' : 'No olvides escuchar esto'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={dismiss}>
            Ahora no
          </Button>
          <Button variant="primary" iconLeft="Inbox" onClick={handleSeeInbox}>
            Ver bandeja
          </Button>
        </>
      }
    >
      <div className={styles.intro}>
        <Icon name="Sparkles" size={20} className={styles.introIcon} />
        <p className={styles.introText}>
          {isPlural
            ? `${items.length} amigos te compartieron música y aun no la has abierto.`
            : `@${items[0].senderUsername} te compartió ${items[0].kind === 'track' ? 'una canción' : 'una playlist'} y aun no la has abierto.`}
        </p>
      </div>

      <ul className={styles.list}>
        {items.map((item) => (
          <li
            key={item.id}
            className={styles.row}
            onClick={() => handlePlayItem(item)}
            role="button"
            tabIndex={0}
          >
            <div className={styles.cover}>
              {(item.coverUrl || item.playlistSnapshot?.tracks?.[0]?.coverUrl) ? (
                <img
                  src={item.coverUrl ?? item.playlistSnapshot.tracks[0].coverUrl}
                  alt=""
                  className={styles.coverImg}
                />
              ) : (
                <Icon name={item.kind === 'playlist' ? 'ListMusic' : 'Music'} size={18} />
              )}
            </div>
            <div className={styles.info}>
              <span className={styles.itemTitle}>
                {item.kind === 'track'
                  ? (item.title ?? 'Track')
                  : (item.playlistName ?? 'Playlist')}
              </span>
              <span className={styles.itemSub}>
                De <strong>@{item.senderUsername}</strong>
                {item.kind === 'track' && item.artist && ` · ${item.artist}`}
              </span>
              {item.message && (
                <div className={styles.bubble}>
                  <Icon name="MessageCircle" size={11} className={styles.bubbleIcon} />
                  <span className={styles.bubbleText}>{item.message}</span>
                </div>
              )}
            </div>
            <button
              type="button"
              className={styles.playBtn}
              aria-label="Reproducir"
              onClick={(e) => { e.stopPropagation(); handlePlayItem(item); }}
            >
              <Icon name="Play" size={12} filled />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
