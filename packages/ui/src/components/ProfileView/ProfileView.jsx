/**
 * ProfileView — perfil publico de un usuario de Ritmiq.
 *
 * Muestra:
 *   - Avatar + @handle + display name + bio
 *   - Estado de amistad con botones de accion (Agregar / Aceptar / Amigos)
 *   - "Escuchando ahora" si el usuario tiene show_activity=true y es amigo
 *   - Acciones: reproducir el mismo track, enviar share
 *
 * @param {{ userId: string }} — recibe userId via view.kind='profile'
 */

import { useEffect, useState } from 'react';
import { useViewStore } from '../../stores/view.js';
import { useSocialStore } from '../../stores/social.js';
import { useAuthStore } from '../../stores/auth.js';
import { usePlayerStore } from '../../stores/player.js';
import { supabase } from '../../lib/supabase.js';
import { Icon } from '../Icon/Icon.jsx';
import { ShareToFriendModal } from '../ShareToFriendModal/ShareToFriendModal.jsx';
import styles from './ProfileView.module.css';

export function ProfileView({ userId }) {
  const currentUser    = useAuthStore((s) => s.user);
  const { goBack, goFriends } = useViewStore();
  const friends        = useSocialStore((s) => s.friends);
  const incomingReqs   = useSocialStore((s) => s.incomingRequests);
  const outgoingReqs   = useSocialStore((s) => s.outgoingRequests);
  const presence       = useSocialStore((s) => s.friendsPresence);

  const [profile, setProfile]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [shareOpen, setShareOpen]   = useState(false);

  // Cargar perfil del usuario
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    supabase
      .from('profiles')
      .select('user_id, username, display_name, avatar_url, bio, show_activity')
      .eq('user_id', userId)
      .single()
      .then(({ data }) => {
        setProfile(data ?? null);
        setLoading(false);
      });
  }, [userId]);

  // Determinar estado de amistad
  const isSelf = currentUser?.id === userId;
  const isFriend = friends.some((f) => f.userId === userId);
  const pendingOut = outgoingReqs.some((r) => r.requesterId === userId);
  const pendingIn  = incomingReqs.find((r) => r.requesterId === userId);

  const presenceEntry = presence.get(userId);

  async function handleAddFriend() {
    setActionBusy(true);
    try { await useSocialStore.getState().sendFriendRequest(userId); } catch {}
    setActionBusy(false);
    // Recargar solicitudes para reflejar el cambio
    if (currentUser) useSocialStore.getState().loadRequests(currentUser.id);
  }

  async function handleAccept() {
    if (!pendingIn) return;
    setActionBusy(true);
    try { await useSocialStore.getState().respondFriendRequest(pendingIn.id, 'accept'); } catch {}
    setActionBusy(false);
    if (currentUser) useSocialStore.getState().loadFriends(currentUser.id);
  }

  async function handleRemove() {
    setActionBusy(true);
    try { await useSocialStore.getState().removeFriend(userId); } catch {}
    setActionBusy(false);
  }

  function handlePlaySameTrack() {
    if (!presenceEntry?.ytId) return;
    usePlayerStore.getState().playNow({
      id:    presenceEntry.ytId,
      ytId:  presenceEntry.ytId,
      yt_id: presenceEntry.ytId,
      title:  presenceEntry.title ?? '',
      artist: presenceEntry.artist ?? '',
      coverUrl:  presenceEntry.coverUrl,
      cover_url: presenceEntry.coverUrl,
      source: 'youtube',
    });
  }

  if (loading) {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={goBack}><Icon name="ArrowLeft" size={20} /></button>
        </header>
        <div className={styles.loadingState}><Icon name="Loader" size={24} /></div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={goBack}><Icon name="ArrowLeft" size={20} /></button>
        </header>
        <div className={styles.empty}>
          <Icon name="UserX" size={40} />
          <p>Usuario no encontrado</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={goBack} aria-label="Volver">
          <Icon name="ArrowLeft" size={20} />
        </button>
        <span className={styles.headerTitle}>@{profile.username}</span>
      </header>

      <div className={styles.body} data-scroll-reset="true">
        {/* Avatar */}
        <div className={styles.avatarWrap}>
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className={styles.avatar} />
          ) : (
            <span className={styles.avatarInitial}>
              {(profile.display_name ?? profile.username ?? '?').slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>

        {/* Info */}
        <h1 className={styles.displayName}>{profile.display_name ?? profile.username}</h1>
        <p className={styles.handle}>@{profile.username}</p>
        {profile.bio && <p className={styles.bio}>{profile.bio}</p>}

        {/* Escuchando ahora */}
        {presenceEntry && (
          <div className={styles.presenceCard} onClick={handlePlaySameTrack}>
            {presenceEntry.coverUrl && (
              <img src={presenceEntry.coverUrl} alt="" className={styles.presenceCover} />
            )}
            <div className={styles.presenceInfo}>
              <span className={styles.presenceLabel}>
                <Icon name="Headphones" size={13} /> Escuchando ahora
              </span>
              <span className={styles.presenceTrack}>
                {presenceEntry.title ?? 'Musica'}
                {presenceEntry.artist ? ` · ${presenceEntry.artist}` : ''}
              </span>
            </div>
            {presenceEntry.ytId && (
              <button className={styles.presencePlay} aria-label="Escuchar esto">
                <Icon name="Play" size={14} filled />
              </button>
            )}
          </div>
        )}

        {/* Acciones de amistad */}
        {!isSelf && (
          <div className={styles.actions}>
            {isFriend ? (
              <>
                <button
                  className={styles.btnShare}
                  onClick={() => setShareOpen(true)}
                  disabled={actionBusy}
                >
                  <Icon name="Send" size={14} /> Compartir track
                </button>
                <button
                  className={styles.btnRemove}
                  onClick={handleRemove}
                  disabled={actionBusy}
                >
                  <Icon name="UserMinus" size={14} /> Eliminar amigo
                </button>
              </>
            ) : pendingIn ? (
              <button
                className={styles.btnAccept}
                onClick={handleAccept}
                disabled={actionBusy}
              >
                <Icon name="UserCheck" size={14} /> Aceptar solicitud
              </button>
            ) : pendingOut ? (
              <span className={styles.pendingLabel}>
                <Icon name="Clock" size={14} /> Solicitud enviada
              </span>
            ) : (
              <button
                className={styles.btnAdd}
                onClick={handleAddFriend}
                disabled={actionBusy}
              >
                <Icon name="UserPlus" size={14} /> Agregar amigo
              </button>
            )}
          </div>
        )}
      </div>

      {shareOpen && (
        // Si hay presencia, compartir ese track; si no, el usuario elige
        <ShareToFriendModal
          track={presenceEntry?.ytId ? {
            ytId:    presenceEntry.ytId,
            title:   presenceEntry.title,
            artist:  presenceEntry.artist,
            coverUrl: presenceEntry.coverUrl,
          } : null}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
