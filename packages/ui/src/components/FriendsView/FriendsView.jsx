/**
 * FriendsView — pantalla principal del sistema social de Ritmiq.
 *
 * Tabs:
 *   'friends'   → lista de amigos mutuos + presencia "Escuchando ahora"
 *   'requests'  → solicitudes entrantes + enviadas
 *   'search'    → buscar usuarios por @handle o email
 *   'inbox'     → items compartidos recibidos (tracks + playlists)
 *
 * @module @ritmiq/ui/components/FriendsView/FriendsView
 */

import { useState, useEffect, useRef } from 'react';
import { useSocialStore } from '../../stores/social.js';
import { useAuthStore } from '../../stores/auth.js';
import { useViewStore } from '../../stores/view.js';
import { usePlayerStore } from '../../stores/player.js';
import { useJamStore } from '../../stores/jam.js';
import { toast } from '../../stores/toast.js';
import { Icon } from '../Icon/Icon.jsx';
import { EmptyState } from '../primitives/index.js';
import { TrackRowSkeleton } from '../Skeleton/index.js';
import styles from './FriendsView.module.css';

// ── Componente raiz ───────────────────────────────────────────────────

export function FriendsView() {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState('friends');

  const incomingCount = useSocialStore((s) => s.incomingRequests.length);
  const unreadInbox   = useSocialStore((s) => s.inbox.filter((i) => !i.readAt).length);
  const jamInviteCount = useSocialStore((s) => s.jamInvites.length);

  // Cargar datos al montar
  useEffect(() => {
    if (!user) return;
    const { loadProfile, loadFriends, loadRequests, loadInbox, loadFriendsPresence, loadJamInvites } =
      useSocialStore.getState();
    loadProfile(user.id);
    loadFriends(user.id);
    loadRequests(user.id);
    loadInbox(user.id);
    loadJamInvites(user.id);
    loadFriendsPresence();
  }, [user]);

  const tabs = [
    { id: 'friends',  label: 'Amigos',     icon: 'Users' },
    { id: 'requests', label: 'Solicitudes', icon: 'UserPlus',  badge: incomingCount + jamInviteCount },
    { id: 'search',   label: 'Buscar',      icon: 'Search' },
    { id: 'inbox',    label: 'Compartido',  icon: 'Inbox',     badge: unreadInbox },
  ];

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>Amigos</h1>
      </header>

      {/* Tab bar */}
      <div className={styles.tabBar} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={styles.tabBtn}
            data-active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={16} />
            <span>{t.label}</span>
            {t.badge > 0 && <span className={styles.badge}>{t.badge > 9 ? '9+' : t.badge}</span>}
          </button>
        ))}
      </div>

      {/* Contenido del tab activo */}
      <div className={styles.content} role="tabpanel" data-scroll-reset="true">
        {tab === 'friends'  && <FriendsTab />}
        {tab === 'requests' && <RequestsTab />}
        {tab === 'search'   && <SearchTab />}
        {tab === 'inbox'    && <InboxTab />}
      </div>
    </div>
  );
}

// ── Tab: Amigos ───────────────────────────────────────────────────────

function FriendsTab() {
  const friends        = useSocialStore((s) => s.friends);
  const friendsLoading = useSocialStore((s) => s.friendsLoading);
  const presence       = useSocialStore((s) => s.friendsPresence);
  const goProfile      = useViewStore((s) => s.goProfile);
  // Invitar a jam: solo disponible si el usuario es HOST de una jam activa.
  const jamMode    = useJamStore((s) => s.mode);
  const jamSession = useJamStore((s) => s.session);
  const canInvite  = jamMode === 'hosting' && !!jamSession;
  const [inviting, setInviting] = useState(null);

  const inviteToJam = async (friend) => {
    if (!jamSession) return;
    setInviting(friend.userId);
    try {
      await useSocialStore.getState().sendJamInvite(friend.userId, jamSession.id);
      toast.success(`Invitación enviada a ${friend.displayName ?? '@' + friend.username}`);
    } catch (e) {
      toast.error(String(e?.message ?? e));
    } finally {
      setInviting(null);
    }
  };

  if (friendsLoading) return <TrackRowSkeleton count={5} />;
  if (friends.length === 0) {
    return (
      <EmptyState
        icon="Users"
        title="Aún no tienes amigos en Ritmiq"
        subtitle='Usa la pestaña "Buscar" para encontrar personas'
      />
    );
  }

  return (
    <ul className={styles.list}>
      {friends.map((f) => {
        const p = presence.get(f.userId);
        return (
          <li key={f.userId} className={styles.friendRow} onClick={() => goProfile(f.userId)}>
            <Avatar user={f} />
            <div className={styles.friendInfo}>
              <span className={styles.displayName}>{f.displayName ?? f.username}</span>
              <span className={styles.username}>@{f.username}</span>
              {p && (
                <div className={styles.presenceRow}>
                  {p.coverUrl && (
                    <img src={p.coverUrl} alt="" className={styles.presenceCover} loading="lazy" />
                  )}
                  <span className={styles.presenceLabel}>
                    <Icon name="Headphones" size={12} />
                    {p.title ?? 'Escuchando musica'}
                    {p.artist ? ` · ${p.artist}` : ''}
                  </span>
                </div>
              )}
            </div>
            {canInvite ? (
              <button
                className={styles.inviteJamBtn}
                disabled={inviting === f.userId}
                onClick={(e) => { e.stopPropagation(); inviteToJam(f); }}
                aria-label={`Invitar a ${f.displayName ?? f.username} a la jam`}
                title="Invitar a la jam"
              >
                <Icon name="Radio" size={14} />
                {inviting === f.userId ? '...' : 'Invitar'}
              </button>
            ) : (
              <Icon name="ChevronRight" size={16} className={styles.chevron} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Tab: Solicitudes ──────────────────────────────────────────────────

function RequestsTab() {
  const incoming        = useSocialStore((s) => s.incomingRequests);
  const outgoing        = useSocialStore((s) => s.outgoingRequests);
  const requestsLoading = useSocialStore((s) => s.requestsLoading);
  const jamInvites      = useSocialStore((s) => s.jamInvites);
  const [responding, setResponding] = useState(null);
  const [respondingJam, setRespondingJam] = useState(null);

  async function respond(friendshipId, action) {
    setResponding(friendshipId);
    try {
      await useSocialStore.getState().respondFriendRequest(friendshipId, action);
    } catch (e) {
      console.error('[friends] respond error', e);
    } finally {
      setResponding(null);
    }
  }

  async function respondJam(inviteId, action) {
    setRespondingJam(inviteId);
    try {
      const { code } = await useSocialStore.getState().respondJamInvite(inviteId, action);
      if (action === 'accept' && code) {
        await useJamStore.getState().joinSession(code);
        useJamStore.getState().openJamModal();
        toast.success('Te uniste a la jam');
      }
    } catch (e) {
      toast.error(String(e?.message ?? e));
    } finally {
      setRespondingJam(null);
    }
  }

  if (requestsLoading) return <TrackRowSkeleton count={3} />;

  const isEmpty = incoming.length === 0 && outgoing.length === 0 && jamInvites.length === 0;

  return (
    <div className={styles.requestsSection}>
      {jamInvites.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>
            <Icon name="Radio" size={14} /> Invitaciones a jam ({jamInvites.length})
          </h2>
          <ul className={styles.list}>
            {jamInvites.map((inv) => (
              <li key={inv.id} className={styles.requestRow}>
                <Avatar user={inv} />
                <div className={styles.friendInfo}>
                  <span className={styles.displayName}>{inv.displayName ?? inv.username}</span>
                  <span className={styles.username}>te invitó a una jam</span>
                </div>
                <div className={styles.requestActions}>
                  <button
                    className={styles.btnAccept}
                    disabled={respondingJam === inv.id}
                    onClick={() => respondJam(inv.id, 'accept')}
                  >
                    {respondingJam === inv.id ? '...' : 'Unirse'}
                  </button>
                  <button
                    className={styles.btnReject}
                    disabled={respondingJam === inv.id}
                    onClick={() => respondJam(inv.id, 'reject')}
                    aria-label="Rechazar invitación"
                  >
                    <Icon name="X" size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {incoming.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>Recibidas ({incoming.length})</h2>
          <ul className={styles.list}>
            {incoming.map((r) => (
              <li key={r.id} className={styles.requestRow}>
                <Avatar user={r} />
                <div className={styles.friendInfo}>
                  <span className={styles.displayName}>{r.displayName ?? r.username}</span>
                  <span className={styles.username}>@{r.username}</span>
                </div>
                <div className={styles.requestActions}>
                  <button
                    className={styles.btnAccept}
                    disabled={responding === r.id}
                    onClick={() => respond(r.id, 'accept')}
                  >
                    {responding === r.id ? '...' : 'Aceptar'}
                  </button>
                  <button
                    className={styles.btnReject}
                    disabled={responding === r.id}
                    onClick={() => respond(r.id, 'reject')}
                  >
                    <Icon name="X" size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>Enviadas ({outgoing.length})</h2>
          <ul className={styles.list}>
            {outgoing.map((r) => (
              <li key={r.id} className={styles.requestRow}>
                <Avatar user={r} />
                <div className={styles.friendInfo}>
                  <span className={styles.displayName}>{r.displayName ?? r.username}</span>
                  <span className={styles.username}>@{r.username}</span>
                </div>
                <span className={styles.pendingLabel}>Pendiente</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isEmpty && (
        <EmptyState icon="UserPlus" title="No hay solicitudes pendientes" />
      )}
    </div>
  );
}

// ── Tab: Buscar ───────────────────────────────────────────────────────

function SearchTab() {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(new Set());
  const debounceRef           = useRef(null);

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const res = await useSocialStore.getState().searchUsers(q.trim());
      setResults(res);
      setLoading(false);
    }, 400);
  }

  async function sendRequest(userId) {
    setSent((s) => new Set([...s, userId]));
    try {
      await useSocialStore.getState().sendFriendRequest(userId);
    } catch (e) {
      setSent((s) => { const n = new Set(s); n.delete(userId); return n; });
      console.error('[friends] sendRequest error', e);
    }
  }

  return (
    <div className={styles.searchSection}>
      <div className={styles.searchBox}>
        <Icon name="Search" size={16} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Buscar por @usuario o email"
          value={query}
          onChange={handleChange}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {loading && <div className={styles.loadingRow}><Icon name="Loader" size={16} /></div>}

      {!loading && results.length === 0 && query.length >= 2 && (
        <EmptyState icon="SearchX" title="Sin resultados" subtitle={`No encontramos "${query}" en Ritmiq`} />
      )}

      <ul className={styles.list}>
        {results.map((u) => (
          <li key={u.userId} className={styles.friendRow}>
            <Avatar user={{ username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl }} />
            <div className={styles.friendInfo}>
              <span className={styles.displayName}>{u.displayName ?? u.username}</span>
              <span className={styles.username}>@{u.username}</span>
            </div>
            <FriendshipButton
              status={sent.has(u.userId) ? 'pending_sent' : u.friendshipStatus}
              onAdd={() => sendRequest(u.userId)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Tab: Inbox (compartido contigo) ───────────────────────────────────

function InboxTab() {
  const inbox        = useSocialStore((s) => s.inbox);
  const inboxLoading = useSocialStore((s) => s.inboxLoading);
  const playNow      = usePlayerStore((s) => s.playNow);

  if (inboxLoading) return <TrackRowSkeleton count={4} />;
  if (inbox.length === 0) {
    return (
      <EmptyState
        icon="Inbox"
        title="Nadie te ha compartido nada aún"
        subtitle="Cuando un amigo comparta un track o playlist aparecerán aquí"
      />
    );
  }

  function handlePlay(item) {
    useSocialStore.getState().markInboxItemRead(item.id);
    // CRITICO: el id del track debe ser 'yt:<ytId>' (no el ytId raw)
    // para que isEphemeralTrack() lo reconozca como efimero. Sin el
    // prefix, el Player asume que es un track persistido y al pulsar
    // Like / Anadir a playlist falla porque trata el ytId como UUID.
    // Bug reportado: 'no puedo agregar a favoritos una cancion que
    // me han compartido'.
    if (item.kind === 'track' && item.ytId) {
      playNow({
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
      playNow(tracks);
    }
  }

  return (
    <ul className={styles.list}>
      {inbox.map((item) => (
        <InboxCard
          key={item.id}
          item={item}
          onPlay={() => handlePlay(item)}
          onSave={() => handleSavePlaylist(item)}
        />
      ))}
    </ul>
  );
}

/**
 * Card unificada para un item del inbox.
 *
 * Estructura visual rediseñada 2026-05-26:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [avatar mini] @user te envió                  │ ← header social
 *   ├──────────────────────────────────────────────┤
 *   │ [COVER]  Título                         [▶] │ ← contenido principal
 *   │  64px    Artista                              │
 *   │          3 tracks (si playlist)               │
 *   ├──────────────────────────────────────────────┤
 *   │   "dfgdg"                                     │ ← mensaje opcional
 *   └──────────────────────────────────────────────┘
 *
 * Mejoras vs version anterior:
 *  - El header social ('@X te envió') reemplaza el 'De @X' suelto al final.
 *  - El mensaje queda contenido visualmente dentro de la card (no full-width).
 *  - El play button esta cerca del contenido, no flotando al extremo.
 *  - Limpia sufijo '- Topic' del artist (canal auto-gen YT Music).
 *  - Card con borde sutil agrupa todo como una unidad coherente.
 */
function InboxCard({ item, onPlay, onSave }) {
  const isTrack = item.kind === 'track';
  const title = isTrack
    ? (item.title ?? 'Track')
    : (item.playlistName ?? 'Playlist');

  // Limpia sufijo '- Topic' (canal auto-gen YT Music) del artist.
  const cleanArtist = (item.artist ?? '').replace(/\s+-\s*Topic\s*$/i, '');

  const subtitle = isTrack
    ? cleanArtist
    : (item.playlistSnapshot?.tracks?.length
        ? `${item.playlistSnapshot.tracks.length} ${item.playlistSnapshot.tracks.length === 1 ? 'canción' : 'canciones'}`
        : '');

  const cover = item.coverUrl ?? item.playlistSnapshot?.tracks?.[0]?.coverUrl ?? null;
  const senderDisplay = item.senderDisplayName ?? item.senderUsername;

  return (
    <li
      className={styles.inboxCard}
      data-unread={!item.readAt}
      onClick={onPlay}
    >
      {/* Header social: avatar mini + acción del sender */}
      <header className={styles.inboxHeader}>
        {item.senderAvatarUrl ? (
          <img
            src={item.senderAvatarUrl}
            alt=""
            className={styles.inboxSenderAvatar}
          />
        ) : (
          <span className={styles.inboxSenderInitial}>
            {senderDisplay.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className={styles.inboxHeaderText}>
          <strong>@{item.senderUsername}</strong> te envió
          {' '}{isTrack ? 'una canción' : 'una playlist'}
        </span>
        {!item.readAt && <span className={styles.unreadDot} aria-label="Sin leer" />}
      </header>

      {/* Contenido principal: cover + info + play */}
      <div className={styles.inboxBody}>
        <div className={styles.inboxCover}>
          {cover ? (
            <img src={cover} alt="" className={styles.inboxCoverImg} loading="lazy" />
          ) : (
            <Icon name={isTrack ? 'Music' : 'ListMusic'} size={22} />
          )}
        </div>

        <div className={styles.inboxInfo}>
          <span className={styles.inboxTitle}>{title}</span>
          {subtitle && <span className={styles.inboxSub}>{subtitle}</span>}
        </div>

        <div className={styles.inboxActions}>
          <button
            className={styles.btnPlay}
            aria-label="Reproducir"
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
          >
            <Icon name="Play" size={15} filled />
          </button>
          {!item.savedAt && !isTrack && (
            <button
              className={styles.btnSave}
              aria-label="Guardar playlist"
              onClick={(e) => { e.stopPropagation(); onSave(); }}
            >
              <Icon name="FolderPlus" size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Mensaje personal opcional — estilo cita, contenido dentro de la card */}
      {item.message && (
        <div className={styles.messageBubble} role="note">
          <Icon name="MessageCircle" size={12} className={styles.messageIcon} />
          <span className={styles.messageText}>{item.message}</span>
        </div>
      )}
    </li>
  );
}

// ── Subcomponentes ────────────────────────────────────────────────────

function Avatar({ user }) {
  if (user?.avatarUrl) {
    return <img src={user.avatarUrl} alt="" className={styles.avatar} loading="lazy" />;
  }
  const initial = (user?.displayName ?? user?.username ?? '?').slice(0, 1).toUpperCase();
  return <span className={styles.avatarInitial}>{initial}</span>;
}

function FriendshipButton({ status, onAdd }) {
  if (status === 'accepted')        return <span className={styles.friendBadge}><Icon name="Check" size={12} /> Amigos</span>;
  if (status === 'pending_sent')    return <span className={styles.pendingLabel}>Enviada</span>;
  if (status === 'pending_received') return <span className={styles.pendingLabel}>Recibida</span>;
  if (status === 'blocked')         return null;
  return (
    <button className={styles.btnAdd} onClick={onAdd}>
      <Icon name="UserPlus" size={14} />
      Agregar
    </button>
  );
}

async function handleSavePlaylist(item) {
  // Importacion diferida para evitar dependencia circular
  const { usePlaylistsStore } = await import('../../stores/playlists.js');
  const { createPlaylist, addTracksToPlaylist } = usePlaylistsStore.getState();
  try {
    const name = item.playlistName ?? `Playlist de @${item.senderUsername}`;
    const playlist = await createPlaylist(name);
    const tracks = (item.playlistSnapshot?.tracks ?? []).map((t) => ({
      ytId: t.ytId, title: t.title, artist: t.artist,
      coverUrl: t.coverUrl, durationSeconds: t.durationSeconds,
      source: 'youtube',
    }));
    await addTracksToPlaylist(playlist.id, tracks);
    await useSocialStore.getState().markInboxItemSaved(item.id);
  } catch (e) {
    console.error('[friends] save playlist error', e);
  }
}
