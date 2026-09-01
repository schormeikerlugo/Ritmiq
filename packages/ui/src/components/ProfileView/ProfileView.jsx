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
import { EmptyState } from '../primitives/index.js';
import { Skeleton } from '../Skeleton/index.js';
import { ShareToFriendModal } from '../ShareToFriendModal/ShareToFriendModal.jsx';
import { toast } from '../../stores/toast.js';
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

  // Playlists visibles del perfil (resueltas por la Edge get-profile-playlists,
  // que respeta visibilidad + amistad).
  const [profilePlaylists, setProfilePlaylists] = useState([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [pullingId, setPullingId] = useState(null);
  const [pulledIds, setPulledIds] = useState(() => new Set());

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

  // Cargar playlists visibles del perfil. Se re-ejecuta si cambia la amistad
  // (al hacerse amigos, aparecen las 'friends'). No aplica al perfil propio.
  useEffect(() => {
    if (!userId || isSelf) { setProfilePlaylists([]); return; }
    let cancelled = false;
    setPlaylistsLoading(true);
    supabase.functions
      .invoke('get-profile-playlists', { body: { ownerId: userId } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setProfilePlaylists([]); }
        else { setProfilePlaylists(data?.playlists ?? []); }
        setPlaylistsLoading(false);
      })
      .catch(() => { if (!cancelled) { setProfilePlaylists([]); setPlaylistsLoading(false); } });
    return () => { cancelled = true; };
  }, [userId, isSelf, isFriend]);

  async function handlePullPlaylist(pl) {
    if (pullingId) return;
    setPullingId(pl.id);
    try {
      const { pullPlaylistSnapshot, notifyPlaylistPulled } = await import('../../lib/pull-playlist.js');
      const res = await pullPlaylistSnapshot({
        name: pl.name,
        tracks: pl.tracks ?? [],
        sourcePlaylistId: pl.id,
        sourceOwnerId: userId,
      });
      if (res) {
        setPulledIds((s) => new Set(s).add(pl.id));
        toast.success(`"${pl.name}" guardada en tu biblioteca`, { icon: 'FolderPlus' });
        // Notificar al dueño (best-effort, no bloquea).
        notifyPlaylistPulled({
          ownerId: userId,
          sourcePlaylistId: pl.id,
          playlistName: pl.name,
          coverUrl: pl.coverUrl ?? null,
          trackCount: pl.trackCount ?? (pl.tracks?.length ?? 0),
        });
      }
    } catch (e) {
      console.error('[profile] pull playlist error', e);
      toast.error('No se pudo guardar la playlist');
    }
    setPullingId(null);
  }

  function handlePlayPlaylist(pl) {
    const tracks = (pl.tracks ?? []).filter((t) => t?.ytId).map((t) => ({
      id: `yt:${t.ytId}`, ytId: t.ytId, yt_id: t.ytId,
      title: t.title ?? '', artist: t.artist ?? '',
      coverUrl: t.coverUrl ?? null, cover_url: t.coverUrl ?? null,
      durationSeconds: t.durationSeconds ?? null, source: 'youtube',
    }));
    if (tracks.length === 0) return;
    usePlayerStore.getState().playNow(tracks, 0, { context: { kind: 'profilePlaylist', ownerId: userId } });
  }
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
          <button className={styles.backBtn} onClick={goBack} aria-label="Volver">
            <Icon name="ArrowLeft" size="lg" />
          </button>
        </header>
        <div className={styles.body}>
          <Skeleton variant="circle" width={96} height={96} />
          <Skeleton width={160} height={26} style={{ marginTop: 12 }} />
          <Skeleton width={100} height={16} style={{ marginTop: 6 }} />
          <Skeleton width={240} height={14} style={{ marginTop: 12 }} />
          <Skeleton width={200} height={14} style={{ marginTop: 4 }} />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={goBack}><Icon name="ArrowLeft" size={20} /></button>
        </header>
        <EmptyState
          icon="UserX"
          title="Usuario no encontrado"
          subtitle="Este perfil no existe o fue eliminado."
        />
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
              <img src={presenceEntry.coverUrl} alt="" className={styles.presenceCover} loading="lazy" />
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

        {/* Playlists visibles del perfil */}
        {!isSelf && (
          <section className={styles.playlistsSection}>
            <h2 className={styles.sectionTitle}>
              <Icon name="ListMusic" size={16} /> Playlists
            </h2>
            {playlistsLoading ? (
              <div className={styles.playlistsGrid}>
                <Skeleton width="100%" height={64} />
                <Skeleton width="100%" height={64} />
              </div>
            ) : profilePlaylists.length === 0 ? (
              <p className={styles.playlistsEmpty}>
                {isFriend
                  ? 'Este usuario no ha compartido playlists.'
                  : 'Hazte amigo para ver sus playlists de solo-amigos.'}
              </p>
            ) : (
              <ul className={styles.playlistsGrid}>
                {profilePlaylists.map((pl) => {
                  const pulled = pulledIds.has(pl.id);
                  const busy = pullingId === pl.id;
                  return (
                    <li key={pl.id} className={styles.playlistCard}>
                      <div className={styles.plCover}>
                        {pl.coverUrl
                          ? <img src={pl.coverUrl} alt="" loading="lazy" />
                          : <Icon name="ListMusic" size={20} />}
                        <button
                          className={styles.plPlay}
                          aria-label="Reproducir"
                          onClick={() => handlePlayPlaylist(pl)}
                          disabled={pl.trackCount === 0}
                        >
                          <Icon name="Play" size={14} filled />
                        </button>
                      </div>
                      <div className={styles.plMeta}>
                        <span className={styles.plName}>{pl.name}</span>
                        <span className={styles.plSub}>
                          {pl.trackCount} {pl.trackCount === 1 ? 'canción' : 'canciones'}
                          {pl.visibility === 'public' && <> · <Icon name="Globe" size={11} /></>}
                          {pl.visibility === 'friends' && <> · <Icon name="Users" size={11} /></>}
                        </span>
                      </div>
                      <button
                        className={styles.plPull}
                        onClick={() => handlePullPlaylist(pl)}
                        disabled={busy || pulled || pl.trackCount === 0}
                        aria-label="Guardar en mi biblioteca"
                      >
                        {busy
                          ? <Icon name="Loader" size={15} className={styles.spin} />
                          : pulled
                            ? <><Icon name="Check" size={15} /> Guardada</>
                            : <><Icon name="FolderPlus" size={15} /> Guardar</>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
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
