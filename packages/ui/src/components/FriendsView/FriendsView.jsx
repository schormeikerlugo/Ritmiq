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
import { Icon } from '../Icon/Icon.jsx';
import styles from './FriendsView.module.css';

// ── Componente raiz ───────────────────────────────────────────────────

export function FriendsView() {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState('friends');

  const incomingCount = useSocialStore((s) => s.incomingRequests.length);
  const unreadInbox   = useSocialStore((s) => s.inbox.filter((i) => !i.readAt).length);

  // Cargar datos al montar
  useEffect(() => {
    if (!user) return;
    const { loadProfile, loadFriends, loadRequests, loadInbox, loadFriendsPresence } =
      useSocialStore.getState();
    loadProfile(user.id);
    loadFriends(user.id);
    loadRequests(user.id);
    loadInbox(user.id);
    loadFriendsPresence();
  }, [user]);

  const tabs = [
    { id: 'friends',  label: 'Amigos',     icon: 'Users' },
    { id: 'requests', label: 'Solicitudes', icon: 'UserPlus',  badge: incomingCount },
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

  if (friendsLoading) return <EmptyState icon="Users" text="Cargando amigos..." />;
  if (friends.length === 0) {
    return (
      <EmptyState
        icon="Users"
        text="Aun no tienes amigos en Ritmiq"
        sub='Usa la pestaña "Buscar" para encontrar personas'
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
                    <img src={p.coverUrl} alt="" className={styles.presenceCover} />
                  )}
                  <span className={styles.presenceLabel}>
                    <Icon name="Headphones" size={12} />
                    {p.title ?? 'Escuchando musica'}
                    {p.artist ? ` · ${p.artist}` : ''}
                  </span>
                </div>
              )}
            </div>
            <Icon name="ChevronRight" size={16} className={styles.chevron} />
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
  const [responding, setResponding] = useState(null);

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

  if (requestsLoading) return <EmptyState icon="UserPlus" text="Cargando solicitudes..." />;

  return (
    <div className={styles.requestsSection}>
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

      {incoming.length === 0 && outgoing.length === 0 && (
        <EmptyState icon="UserPlus" text="No hay solicitudes pendientes" />
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
        <EmptyState icon="SearchX" text="Sin resultados" sub={`No encontramos "${query}" en Ritmiq`} />
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

  if (inboxLoading) return <EmptyState icon="Inbox" text="Cargando bandeja..." />;
  if (inbox.length === 0) {
    return (
      <EmptyState
        icon="Inbox"
        text="Nadie te ha compartido nada aun"
        sub="Cuando un amigo comparta un track o playlist apareceran aqui"
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
        <li
          key={item.id}
          className={styles.inboxRow}
          data-unread={!item.readAt}
          onClick={() => handlePlay(item)}
        >
          {/* Cover */}
          <div className={styles.inboxCover}>
            {(item.coverUrl || item.playlistSnapshot?.tracks?.[0]?.coverUrl) ? (
              <img
                src={item.coverUrl ?? item.playlistSnapshot.tracks[0].coverUrl}
                alt=""
                className={styles.inboxCoverImg}
              />
            ) : (
              <Icon name={item.kind === 'playlist' ? 'ListMusic' : 'Music'} size={20} />
            )}
          </div>

          {/* Info */}
          <div className={styles.inboxInfo}>
            <span className={styles.inboxTitle}>
              {item.kind === 'track'
                ? (item.title ?? 'Track')
                : (item.playlistName ?? 'Playlist')}
            </span>
            {item.kind === 'track' && item.artist && (
              <span className={styles.inboxSub}>{item.artist}</span>
            )}
            {item.kind === 'playlist' && item.playlistSnapshot?.tracks && (
              <span className={styles.inboxSub}>
                {item.playlistSnapshot.tracks.length} tracks
              </span>
            )}
            <span className={styles.inboxSender}>
              De <strong>@{item.senderUsername}</strong>
            </span>

            {/* Burbuja con el mensaje personal — destacado para que no se
                pierda visualmente entre el resto de metadatos. */}
            {item.message && (
              <div className={styles.messageBubble} role="note">
                <Icon name="MessageCircle" size={13} className={styles.messageIcon} />
                <span className={styles.messageText}>{item.message}</span>
              </div>
            )}
          </div>

          {/* Acciones */}
          <div className={styles.inboxActions}>
            <button
              className={styles.btnPlay}
              aria-label="Reproducir"
              onClick={(e) => { e.stopPropagation(); handlePlay(item); }}
            >
              <Icon name="Play" size={14} filled />
            </button>
            {!item.savedAt && item.kind === 'playlist' && (
              <button
                className={styles.btnSave}
                aria-label="Guardar playlist"
                onClick={(e) => { e.stopPropagation(); handleSavePlaylist(item); }}
              >
                <Icon name="FolderPlus" size={14} />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Subcomponentes ────────────────────────────────────────────────────

function Avatar({ user }) {
  if (user?.avatarUrl) {
    return <img src={user.avatarUrl} alt="" className={styles.avatar} />;
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

function EmptyState({ icon, text, sub }) {
  return (
    <div className={styles.empty}>
      <Icon name={icon} size={40} />
      <p className={styles.emptyText}>{text}</p>
      {sub && <p className={styles.emptySub}>{sub}</p>}
    </div>
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
