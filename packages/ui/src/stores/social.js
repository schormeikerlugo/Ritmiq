/**
 * useSocialStore — estado global del sistema social de Ritmiq.
 *
 * Gestiona:
 *   - Perfil propio (profile)
 *   - Lista de amigos mutuos (friends)
 *   - Solicitudes de amistad pendientes entrantes (incomingRequests)
 *   - Solicitudes enviadas pendientes (outgoingRequests)
 *   - Bandeja de items compartidos recibidos (inbox)
 *   - Presencia de amigos (friendsPresence)
 *
 * Patron: load() hidrata desde Supabase. Realtime suscripciones en
 * use-social-realtime.js mantienen el estado fresco sin polling.
 *
 * Las acciones mutantes (sendFriendRequest, respondFriendRequest, sendShare)
 * llaman a las Edge Functions y actualizan el store optimisticamente.
 *
 * @module @ritmiq/ui/stores/social
 */

import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';

/** @typedef {{ userId:string, username:string, displayName:string|null, avatarUrl:string|null }} Profile */
/** @typedef {{ id:string, userId:string, username:string, displayName:string|null, avatarUrl:string|null }} Friend */
/** @typedef {{ id:string, requesterId:string, username:string, displayName:string|null, avatarUrl:string|null, createdAt:string }} FriendRequest */
/** @typedef {{ id:string, senderId:string, senderUsername:string, senderDisplayName:string|null, senderAvatarUrl:string|null, kind:'track'|'playlist', ytId?:string, title?:string, artist?:string, coverUrl?:string, durationSeconds?:number, playlistName?:string, playlistSnapshot?:object, message?:string, readAt:string|null, savedAt:string|null, playedAt:string|null, createdAt:string }} SharedItem */
/** @typedef {{ userId:string, ytId:string, title:string|null, artist:string|null, coverUrl:string|null, positionSeconds:number, expiresAt:string }} PresenceEntry */

export const useSocialStore = create((set, get) => ({
  // ── Estado ─────────────────────────────────────────────────────────
  /** @type {Profile|null} */
  profile: null,
  profileLoading: false,
  profileError: null,

  /** @type {Friend[]} amigos con status='accepted' */
  friends: [],
  friendsLoading: false,

  /** @type {FriendRequest[]} solicitudes entrantes pendientes */
  incomingRequests: [],
  /** @type {FriendRequest[]} solicitudes enviadas pendientes */
  outgoingRequests: [],
  requestsLoading: false,

  /** @type {SharedItem[]} bandeja de items recibidos */
  inbox: [],
  inboxLoading: false,

  /** @type {Map<string, PresenceEntry>} presencia activa por userId */
  friendsPresence: new Map(),

  /** Conteo de solicitudes + inbox no leidos para badge en UI */
  get pendingCount() {
    return get().incomingRequests.length + get().inbox.filter((i) => !i.readAt).length;
  },

  // ── Perfil propio ──────────────────────────────────────────────────

  async loadProfile(userId) {
    set({ profileLoading: true, profileError: null });
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, username, display_name, avatar_url, bio, show_activity, timezone')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      set({ profileLoading: false, profileError: error.message });
      return null;
    }
    if (!data) {
      // Perfil no existe — crear uno. Si el usuario eligio username y/o
      // display_name al registrarse (user_metadata desde signUp), los usamos.
      // Si no, fallback a user_<8chars-del-uid>.
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const meta = authUser?.user_metadata ?? {};

      let username = (meta.username ?? '').trim().toLowerCase();
      if (!username || username.length < 3 || !/^[a-z0-9_]+$/.test(username)) {
        username = 'user_' + userId.replace(/-/g, '').slice(0, 8);
      }
      const displayName = (meta.display_name ?? '').trim() || null;

      // Intentar insertar con timezone detectada del browser \u2014 asi
      // los reminders de streak llegan en hora local desde el primer
      // dia, sin esperar a que el usuario haga otra accion.
      const tz = detectTimezone();

      let insertResult = await supabase
        .from('profiles')
        .insert({ user_id: userId, username, display_name: displayName, timezone: tz })
        .select('user_id, username, display_name, avatar_url, bio, show_activity, timezone')
        .single();

      if (insertResult.error?.code === '23505') {
        // Unique violation — username tomado. Reintentar con generico.
        username = 'user_' + userId.replace(/-/g, '').slice(0, 8);
        insertResult = await supabase
          .from('profiles')
          .insert({ user_id: userId, username, display_name: displayName, timezone: tz })
          .select('user_id, username, display_name, avatar_url, bio, show_activity, timezone')
          .single();
      }

      const profile = insertResult.data ? mapProfile(insertResult.data) : null;
      set({ profile, profileLoading: false });
      return profile;
    }

    const profile = mapProfile(data);
    set({ profile, profileLoading: false });

    // Sync de timezone: si el browser detecta una zona distinta a la
    // guardada (ej. el usuario viajo, cambio de SO, o login desde otro
    // device en otro pais), actualizar silenciosamente en background.
    // No bloqueante \u2014 el profile ya esta en memoria con el valor
    // antiguo, el proximo refresh leera el nuevo.
    const browserTz = detectTimezone();
    if (browserTz && browserTz !== profile.timezone) {
      supabase
        .from('profiles')
        .update({ timezone: browserTz })
        .eq('user_id', userId)
        .then(({ error: tzErr }) => {
          if (!tzErr) {
            // Actualizar la copia en memoria sin re-fetch.
            const current = get().profile;
            if (current?.userId === userId) {
              set({ profile: { ...current, timezone: browserTz } });
            }
          }
        });
    }

    return profile;
  },

  /**
   * Actualiza solo los campos presentes en `patch` (omite undefined).
   * Asi una llamada parcial como `updateProfile({ showActivity: false })`
   * no setea username/avatar a null por accidente.
   *
   * @param {{username?:string, displayName?:string, avatarUrl?:string|null, bio?:string, showActivity?:boolean}} patch
   * @returns {Promise<Error|null>}
   */
  async updateProfile(patch) {
    const { profile } = get();
    if (!profile) return null;

    // Mapear solo los campos definidos a snake_case del schema
    const update = {};
    if (patch.username     !== undefined) update.username      = patch.username;
    if (patch.displayName  !== undefined) update.display_name  = patch.displayName;
    if (patch.avatarUrl    !== undefined) update.avatar_url    = patch.avatarUrl;
    if (patch.bio          !== undefined) update.bio           = patch.bio;
    if (patch.showActivity !== undefined) update.show_activity = patch.showActivity;
    if (Object.keys(update).length === 0) return null;

    const { data, error } = await supabase
      .from('profiles')
      .update(update)
      .eq('user_id', profile.userId)
      .select('user_id, username, display_name, avatar_url, bio, show_activity')
      .single();
    if (error) {
      console.warn('[social] updateProfile error', error);
      return error;
    }
    if (data) set({ profile: mapProfile(data) });
    return null;
  },

  /**
   * Sube un archivo de imagen al bucket 'avatars' (path
   * <user_id>/avatar.<ext>), obtiene la public URL y actualiza
   * profile.avatar_url. Devuelve la URL nueva o null en error.
   *
   * @param {File} file - jpeg/png/webp, max 2MB.
   * @returns {Promise<string|null>}
   */
  async uploadAvatar(file) {
    const { profile } = get();
    if (!profile || !file) return null;

    // Validacion cliente (server tambien valida via bucket config)
    if (file.size > 2 * 1024 * 1024) throw new Error('La imagen no debe superar 2 MB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Formato no soportado. Usa JPG, PNG o WebP.');
    }

    const ext = file.type === 'image/png' ? 'png'
              : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${profile.userId}/avatar.${ext}`;

    // Upload con upsert: sobrescribe la version anterior
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
    if (upErr) {
      console.warn('[social] avatar upload error', upErr);
      throw new Error(upErr.message ?? 'No se pudo subir la imagen.');
    }

    // Public URL con cache buster para que los amigos vean el cambio inmediato
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = `${pub.publicUrl}?v=${Date.now()}`;

    // Actualizar el campo avatar_url en el perfil
    const err = await get().updateProfile({ avatarUrl: url });
    if (err) throw err;
    return url;
  },

  /** Elimina el avatar del bucket y limpia avatar_url del perfil. */
  async removeAvatar() {
    const { profile } = get();
    if (!profile) return;
    // No sabemos la extension exacta; intentamos las 3.
    await supabase.storage.from('avatars').remove([
      `${profile.userId}/avatar.jpg`,
      `${profile.userId}/avatar.png`,
      `${profile.userId}/avatar.webp`,
    ]);
    await get().updateProfile({ avatarUrl: null });
  },

  // ── Amigos ─────────────────────────────────────────────────────────

  async loadFriends(userId) {
    set({ friendsLoading: true });
    // mutual_friends es una VIEW (no tabla) por lo que PostgREST no puede
    // hacer embedded joins. Hacemos dos pasos: 1) IDs de amigos, 2) lookup
    // de perfiles. Mas robusto que confiar en hidden FK.
    const { data: friendRows } = await supabase
      .from('mutual_friends')
      .select('friend_id')
      .eq('user_id', userId);

    const ids = (friendRows ?? []).map((r) => r.friend_id);
    if (ids.length === 0) {
      set({ friends: [], friendsLoading: false });
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, username, display_name, avatar_url')
      .in('user_id', ids);

    const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    const friends = ids.map((id) => {
      const p = profileMap.get(id);
      return {
        id,
        userId:      id,
        username:    p?.username ?? '',
        displayName: p?.display_name ?? null,
        avatarUrl:   p?.avatar_url ?? null,
      };
    });
    set({ friends, friendsLoading: false });
  },

  // ── Solicitudes ────────────────────────────────────────────────────

  async loadRequests(userId) {
    set({ requestsLoading: true });

    // friendships.requester/addressee referencian auth.users (no profiles),
    // por lo que PostgREST no puede joinar profiles automaticamente.
    // Hacemos dos pasos: 1) traer friendships, 2) lookup de perfiles.
    const [incoming, outgoing] = await Promise.all([
      supabase
        .from('friendships')
        .select('id, requester, created_at')
        .eq('addressee', userId)
        .eq('status', 'pending'),
      supabase
        .from('friendships')
        .select('id, addressee, created_at')
        .eq('requester', userId)
        .eq('status', 'pending'),
    ]);

    const inRows  = incoming.data ?? [];
    const outRows = outgoing.data ?? [];
    const allIds = [
      ...inRows.map((r) => r.requester),
      ...outRows.map((r) => r.addressee),
    ];

    let profileMap = new Map();
    if (allIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, username, display_name, avatar_url')
        .in('user_id', allIds);
      profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    }

    set({
      incomingRequests: inRows.map((r) => {
        const p = profileMap.get(r.requester);
        return {
          id:          r.id,
          requesterId: r.requester,
          username:    p?.username ?? '',
          displayName: p?.display_name ?? null,
          avatarUrl:   p?.avatar_url ?? null,
          createdAt:   r.created_at,
        };
      }),
      outgoingRequests: outRows.map((r) => {
        const p = profileMap.get(r.addressee);
        return {
          id:          r.id,
          requesterId: r.addressee,
          username:    p?.username ?? '',
          displayName: p?.display_name ?? null,
          avatarUrl:   p?.avatar_url ?? null,
          createdAt:   r.created_at,
        };
      }),
      requestsLoading: false,
    });
  },

  /** Envia solicitud de amistad via Edge Function */
  async sendFriendRequest(addresseeId) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const res = await supabase.functions.invoke('send-friend-request', {
      body: { addresseeId },
    });
    if (res.error) throw new Error(res.error.message);
    return res.data;
  },

  /** Acepta/rechaza solicitud via Edge Function */
  async respondFriendRequest(friendshipId, action) {
    const res = await supabase.functions.invoke('respond-friend-request', {
      body: { friendshipId, action },
    });
    if (res.error) throw new Error(res.error.message);

    // Actualizar estado local
    if (action === 'accept') {
      const req = get().incomingRequests.find((r) => r.id === friendshipId);
      if (req) {
        set((s) => ({
          incomingRequests: s.incomingRequests.filter((r) => r.id !== friendshipId),
          friends: [...s.friends, {
            id:          req.requesterId,
            userId:      req.requesterId,
            username:    req.username,
            displayName: req.displayName,
            avatarUrl:   req.avatarUrl,
          }],
        }));
      }
    } else {
      set((s) => ({
        incomingRequests: s.incomingRequests.filter((r) => r.id !== friendshipId),
      }));
    }
    return res.data;
  },

  /** Elimina una amistad existente */
  async removeFriend(friendId) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase
      .from('friendships')
      .delete()
      .or(
        `and(requester.eq.${session.user.id},addressee.eq.${friendId}),` +
        `and(requester.eq.${friendId},addressee.eq.${session.user.id})`,
      );
    set((s) => ({ friends: s.friends.filter((f) => f.userId !== friendId) }));
  },

  // ── Inbox (items compartidos) ───────────────────────────────────────

  async loadInbox(userId) {
    set({ inboxLoading: true });
    // shared_items.sender_id referencia auth.users, no profiles. Hacemos
    // dos queries: 1) items, 2) profiles de los senders.
    const { data: items } = await supabase
      .from('shared_items')
      .select(`
        id, sender_id, kind, yt_id, title, artist, cover_url, duration_seconds,
        playlist_name, playlist_snapshot, message,
        read_at, saved_at, played_at, created_at
      `)
      .eq('receiver_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    const rows = items ?? [];
    const senderIds = [...new Set(rows.map((r) => r.sender_id))];

    let profileMap = new Map();
    if (senderIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, username, display_name, avatar_url')
        .in('user_id', senderIds);
      profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    }

    set({
      inbox: rows.map((row) => mapSharedItem(row, profileMap.get(row.sender_id))),
      inboxLoading: false,
    });
  },

  async markInboxItemRead(itemId) {
    await supabase
      .from('shared_items')
      .update({ read_at: new Date().toISOString() })
      .eq('id', itemId);
    set((s) => ({
      inbox: s.inbox.map((i) => i.id === itemId ? { ...i, readAt: new Date().toISOString() } : i),
    }));
  },

  async markInboxItemSaved(itemId) {
    await supabase
      .from('shared_items')
      .update({ saved_at: new Date().toISOString() })
      .eq('id', itemId);
    set((s) => ({
      inbox: s.inbox.map((i) => i.id === itemId ? { ...i, savedAt: new Date().toISOString() } : i),
    }));
  },

  /** Comparte un track o playlist con un amigo via Edge Function */
  async sendShare(payload) {
    const res = await supabase.functions.invoke('send-share', { body: payload });
    if (res.error) throw new Error(res.error.message);
    return res.data;
  },

  // ── Presencia de amigos ─────────────────────────────────────────────

  /** Actualiza la presencia de un amigo en el Map local */
  setFriendPresence(userId, entry) {
    set((s) => {
      const next = new Map(s.friendsPresence);
      if (entry) {
        next.set(userId, entry);
      } else {
        next.delete(userId);
      }
      return { friendsPresence: next };
    });
  },

  /** Carga presencia activa de todos los amigos */
  async loadFriendsPresence() {
    const { data } = await supabase
      .from('presence')
      .select('user_id, yt_id, title, artist, cover_url, position_seconds, expires_at')
      .gt('expires_at', new Date().toISOString());

    const map = new Map();
    for (const row of (data ?? [])) {
      map.set(row.user_id, {
        userId:          row.user_id,
        ytId:            row.yt_id,
        title:           row.title,
        artist:          row.artist,
        coverUrl:        row.cover_url,
        positionSeconds: row.position_seconds ?? 0,
        expiresAt:       row.expires_at,
      });
    }
    set({ friendsPresence: map });
  },

  // ── Busqueda de usuarios ────────────────────────────────────────────

  /** Busca usuarios por @username o email. Devuelve array de resultados. */
  async searchUsers(query) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];

    const url = new URL(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search-users`,
    );
    url.searchParams.set('q', query);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.users ?? [];
  },

  // ── Reset (logout) ─────────────────────────────────────────────────

  reset() {
    set({
      profile: null,
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      inbox: [],
      friendsPresence: new Map(),
      profileLoading: false,
      friendsLoading: false,
      requestsLoading: false,
      inboxLoading: false,
    });
  },
}));

// ── Helpers de mapeo ──────────────────────────────────────────────────

function mapProfile(row) {
  return {
    userId:       row.user_id,
    username:     row.username,
    displayName:  row.display_name ?? null,
    avatarUrl:    row.avatar_url ?? null,
    bio:          row.bio ?? null,
    showActivity: row.show_activity ?? true,
    timezone:     row.timezone ?? 'UTC',
  };
}

/**
 * Detecta la IANA timezone del browser. Devuelve 'UTC' como fallback
 * si Intl no esta disponible (entornos muy raros).
 */
function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function mapSharedItem(row, senderProfile) {
  return {
    id:                row.id,
    kind:              row.kind,
    senderId:          row.sender_id ?? senderProfile?.user_id ?? '',
    senderUsername:    senderProfile?.username ?? '',
    senderDisplayName: senderProfile?.display_name ?? null,
    senderAvatarUrl:   senderProfile?.avatar_url ?? null,
    ytId:              row.yt_id ?? null,
    title:             row.title ?? null,
    artist:            row.artist ?? null,
    coverUrl:          row.cover_url ?? null,
    durationSeconds:   row.duration_seconds ?? null,
    playlistName:      row.playlist_name ?? null,
    playlistSnapshot:  row.playlist_snapshot ?? null,
    message:           row.message ?? null,
    readAt:            row.read_at ?? null,
    savedAt:           row.saved_at ?? null,
    playedAt:          row.played_at ?? null,
    createdAt:         row.created_at,
  };
}
