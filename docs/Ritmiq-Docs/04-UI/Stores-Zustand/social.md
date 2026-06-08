---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/social.js
tags: [store, social, amigos, perfil, presencia, inbox]
---

# `stores/social.js`

> Store del sistema social de Ritmiq. Gestiona perfil propio, amigos mutuos, solicitudes de amistad, inbox de items compartidos y presencia en tiempo real.

## Ubicación
`packages/ui/src/stores/social.js:1` (573 líneas)

## Estado

```js
{
  profile: Profile | null,
  profileLoading: boolean, profileError: string|null,

  friends: Friend[],
  friendsLoading: boolean,

  incomingRequests: FriendRequest[],
  outgoingRequests: FriendRequest[],
  requestsLoading: boolean,

  inbox: SharedItem[],
  inboxLoading: boolean,

  friendsPresence: Map<userId, PresenceEntry>,
}
```

## Getter derivado

```js
get pendingCount() {
  return incomingRequests.length + inbox.filter(i => !i.readAt).length;
}
```

Usado por [[BottomNav]] / [[Sidebar]] para el badge de notificaciones.

## Tipos

```js
/** @typedef {{ userId, username, displayName, avatarUrl, bio, showActivity, timezone }} Profile */
/** @typedef {{ id, userId, username, displayName, avatarUrl }} Friend */
/** @typedef {{ id, requesterId, username, displayName, avatarUrl, createdAt }} FriendRequest */
/** @typedef {{ id, senderId, senderUsername, kind:'track'|'playlist', ytId?, title?, coverUrl?, ... readAt, savedAt, playedAt, createdAt }} SharedItem */
/** @typedef {{ userId, ytId, title, artist, coverUrl, positionSeconds, expiresAt }} PresenceEntry */
```

## Acciones

| Acción | Supabase | Descripción |
|---|---|---|
| `loadProfile(userId)` | `profiles` table | Carga o **crea** perfil automáticamente |
| `updateProfile(patch)` | `profiles` PATCH | Solo actualiza campos definidos |
| `uploadAvatar(file)` | Storage `avatars` | Valida 2MB, sube, actualiza avatar_url |
| `removeAvatar()` | Storage `avatars` | Intenta borrar las 3 extensiones |
| `loadFriends(userId)` | `mutual_friends` VIEW | Dos queries: IDs + perfiles |
| `loadRequests(userId)` | `friendships` table | incoming + outgoing simultáneo |
| `sendFriendRequest(addresseeId)` | Edge [[send-friend-request]] | |
| `respondFriendRequest(id, action)` | Edge [[respond-friend-request]] | Optimistic update |
| `removeFriend(friendId)` | `friendships` DELETE OR | |
| `loadInbox(userId)` | `shared_items` | Dos queries: items + senderProfiles |
| `markInboxItemRead(itemId)` | `shared_items` UPDATE | |
| `markInboxItemSaved(itemId)` | `shared_items` UPDATE | |
| `sendShare(payload)` | Edge [[send-share]] | |
| `loadFriendsPresence()` | `presence` table | Filtra expirados |
| `setFriendPresence(userId, entry)` | — | Update local del Map |
| `searchUsers(query)` | Edge [[search-users]] | |
| `reset()` | — | Limpia todo en logout |

## Anatomía del código (snippets clave)

### 1. `loadProfile`: creación automática con username retry
`packages/ui/src/stores/social.js:61-110`

```js
if (!data) {
  // Perfil no existe — crear. Intentar con username elegido al registrarse.
  const meta = authUser?.user_metadata ?? {};
  let username = (meta.username ?? '').trim().toLowerCase();
  if (!username || username.length < 3 || !/^[a-z0-9_]+$/.test(username)) {
    username = 'user_' + userId.replace(/-/g, '').slice(0, 8);
  }

  let insertResult = await supabase.from('profiles').insert({ user_id: userId, username, ... });

  if (insertResult.error?.code === '23505') {
    // Unique violation — username tomado. Reintentar con genérico.
    username = 'user_' + userId.replace(/-/g, '').slice(0, 8);
    insertResult = await supabase.from('profiles').insert({ user_id: userId, username, ... });
  }
}
```

**Flujo de username**: `user_metadata.username` (elegido en onboarding) → fallback `user_<8chars_uid>` si es inválido → si ese también colisiona (muy improbable: 8 chars del UUID), el segundo insert falla silenciosamente (insertResult.data = null, profile = null).

**Por qué no hacer `upsert` directamente**: queremos el intento con el username elegido primero. Si hacemos upsert con el genérico, perdemos el username que el usuario eligió al registrarse.

### 2. `loadProfile`: sync de timezone en background
`packages/ui/src/stores/social.js:117-135`

```js
const browserTz = detectTimezone();
if (browserTz && browserTz !== profile.timezone) {
  supabase.from('profiles').update({ timezone: browserTz })
    .eq('user_id', userId).then(({ error: tzErr }) => {
      if (!tzErr) {
        const current = get().profile;
        if (current?.userId === userId) {
          set({ profile: { ...current, timezone: browserTz } });
        }
      }
    });
}
```

**Por qué no bloqueante**: detectar y actualizar el timezone es un UX improvement (los reminders de streak llegan en hora local). No vale la pena bloquear el render por esto.

**Por qué comprobar `current?.userId === userId`**: si el usuario se deslogueó entre el `loadProfile` y la respuesta del UPDATE, `get().profile` puede ser null o de otro usuario. Solo actualizamos si seguimos siendo el mismo usuario.

### 3. `updateProfile`: patch parcial con mapeo snake_case
`packages/ui/src/stores/social.js:148-173`

```js
async updateProfile(patch) {
  const update = {};
  if (patch.username     !== undefined) update.username      = patch.username;
  if (patch.displayName  !== undefined) update.display_name  = patch.displayName;
  if (patch.avatarUrl    !== undefined) update.avatar_url    = patch.avatarUrl;
  // ...solo los campos definidos
  if (Object.keys(update).length === 0) return null;

  const { data, error } = await supabase.from('profiles')
    .update(update).eq('user_id', profile.userId)
    .select('...').single();
}
```

**Por qué comprobar `!== undefined` y no `if (patch.x)`**: permite pasar `{ avatarUrl: null }` para borrar el avatar. Si usáramos `if (patch.avatarUrl)`, `null` sería falsy y el borrado no se enviaría.

### 4. `loadFriends`: dos queries porque `mutual_friends` es una VIEW
`packages/ui/src/stores/social.js:232-263`

```js
// mutual_friends es una VIEW (no tabla) — PostgREST no puede hacer
// embedded joins. Hacemos dos pasos: 1) IDs de amigos, 2) lookup de perfiles.
const { data: friendRows } = await supabase.from('mutual_friends')
  .select('friend_id').eq('user_id', userId);
const ids = (friendRows ?? []).map((r) => r.friend_id);
const { data: profiles } = await supabase.from('profiles')
  .select('user_id, username, display_name, avatar_url')
  .in('user_id', ids);
```

**Por qué VIEW y no tabla**: `mutual_friends` es bidireccional. Para una `friendships` donde `requester=A` y `addressee=B`, ambos `A` y `B` deben verse mutuamente en su lista de amigos. Una tabla necesitaría duplicar las filas; una VIEW deriva la bidireccionalidad automáticamente.

**Por qué dos queries**: PostgREST (la API de Supabase sobre Postgres) no puede hacer `join` sobre una VIEW que no tiene FK explícitas. Hacemos los dos requests manuales.

### 5. `uploadAvatar`: cache buster en la URL
`packages/ui/src/stores/social.js:206-213`

```js
const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
const url = `${pub.publicUrl}?v=${Date.now()}`;
```

**Por qué cache buster**: los avatares usan el mismo path `<user_id>/avatar.<ext>`. Si el usuario cambia su avatar, la URL pública es idéntica pero el contenido cambió. Sin `?v=timestamp`, el navegador y los CDNs de Supabase Storage sirven el avatar antiguo del caché durante `cacheControl: 3600` (1 hora).

## Casos de borde

- **`removeFriend` borra la friendship en ambas direcciones**: el `.or()` en el DELETE maneja ambas dirección (`A→B` y `B→A`) en una sola query. Sin esto, habría que saber quién fue el requester original.
- **`pendingCount` getter en Zustand**: Zustand no soporta getters de clase nativa. Este `get pendingCount()` es una sintaxis de JavaScript que Zustand no llama automáticamente. El componente debe calcularlo manualmente o usar `useSocialStore(s => s.incomingRequests.length + s.inbox.filter(i => !i.readAt).length)`.
- **`removeAvatar` sin conocer extensión**: intenta borrar `.jpg`, `.png` y `.webp`. Si el archivo es `.jpg` pero el path en la DB dice `.webp`, el Storage borra `.jpg` pero la `avatar_url` apunta a `.webp` inexistente.
- **`loadFriendsPresence` no filtra amigos**: devuelve toda la presencia del query `WHERE expires_at > now()`, no solo de amigos. El componente [[FriendsView]] debe filtrar contra `friends` array. Puede traer presencia de usuarios desconocidos si la tabla `presence` tiene entradas viejas no expiradas de users que ya no son amigos.

## Performance y costes

| Operación | Queries Supabase |
|---|---|
| `loadFriends(userId)` | 2 queries (VIEW + profiles IN) |
| `loadRequests(userId)` | 2 paralelas (friendships incoming + outgoing) + 1 profiles IN |
| `loadInbox(userId)` | 2 (shared_items + profiles IN) |
| `loadProfile(userId)` | 1 SELECT + (creación: 1-2 INSERT) + bg timezone update |

En total, un `load completo del sistema social` = ~7-10 queries Supabase. No hay optimización de batching hoy.

## Dependencias entrantes
- [[App]] → `loadProfile`, `loadFriends`, `loadRequests`, `loadInbox` al iniciar.
- [[FriendsView]], [[ProfileView]], [[SharedView]] componentes.
- [[use-social-realtime]] hook → `setFriendPresence`.
- [[use-presence]] hook → `setFriendPresence`.

## Dependencias salientes
- [[supabase|ui/lib/supabase]] (todas las queries de tabla).
- Edge Functions: [[send-friend-request]], [[respond-friend-request]], [[send-share]], [[search-users]].

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| `updateProfile` con `if (patch.x)` en lugar de `!== undefined` | `{ avatarUrl: null }` no limpia el avatar — queda la URL antigua. |
| Quitar cache buster en `uploadAvatar` | Avatar nuevo no se ve hasta que el caché del CDN expira (1 hora). |
| `loadFriends` con join directo (cuando VIEW sea tabla) | Si `mutual_friends` se convierte en tabla con FKs, PostgREST puede joinar. Pero hoy no tiene FKs explícitas. |
| `reset()` que no limpia `friendsPresence` | Presencia del usuario anterior visible para el siguiente que hace login. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
- 2026-06-01 (**invitaciones de jam**, Bloque 3.6): estado nuevo `jamInvites[]`; `pendingCount`
  ahora suma las invitaciones. Acciones: `loadJamInvites(userId)` (fetch pendientes + perfiles
  de quien invita), `sendJamInvite(receiverId, sessionId)` (edge [[send-jam-invite]]),
  `respondJamInvite(inviteId, action)` (edge [[respond-jam-invite]]; en accept devuelve `{code}`
  para `joinSession`). `reset()` limpia `jamInvites`. Ver [[jam_invites]] y
  [[Decisiones-Tecnicas-ADR|ADR-025]].
