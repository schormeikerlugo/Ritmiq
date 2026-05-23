---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260521000001_friendships.sql
tags: [tabla, social, amistad, mutual]
---

# `friendships` + view `mutual_friends`

> Relaciones de amistad. UNIQUE en el par no ordenado (no se duplica A→B y B→A). VIEW `mutual_friends` deriva la lista bidireccional para consultas.

## `friendships`

```sql
id          uuid PK,
requester   uuid NOT NULL → auth.users(id) ON DELETE CASCADE,
addressee   uuid NOT NULL → auth.users(id) ON DELETE CASCADE,
status      text NOT NULL CHECK (status IN ('pending','accepted','rejected','blocked')),
created_at  timestamptz,
updated_at  timestamptz,
UNIQUE (LEAST(requester, addressee), GREATEST(requester, addressee))
```

## VIEW `mutual_friends`

Deriva la lista bidireccional:

```sql
CREATE VIEW mutual_friends AS
SELECT requester AS user_id, addressee AS friend_id FROM friendships WHERE status='accepted'
UNION ALL
SELECT addressee AS user_id, requester AS friend_id FROM friendships WHERE status='accepted';
```

**Por qué VIEW**: `friendships` solo tiene una fila por relación. Para que A vea a B y B vea a A en sus listas de amigos sin duplicar filas, la VIEW expande la bidireccionalidad.

## RLS

- SELECT: usuarios pueden ver friendships donde son requester o addressee.
- INSERT/UPDATE/DELETE: solo participantes.

## Edge Functions relacionadas

- [[send-friend-request]]
- [[respond-friend-request]]

## Cliente

- [[social]] store → `loadFriends`, `loadRequests`, `removeFriend`.

## Notas / Changelog
- 2026-05-22: nivel simple.
