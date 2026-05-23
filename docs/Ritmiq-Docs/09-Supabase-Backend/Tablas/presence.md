---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260521000003_presence.sql
tags: [tabla, social, presencia, realtime, ttl]
---

# `presence`

> Estado "escuchando ahora" por usuario. TTL 2 min (la PWA hace upsert cada 30s; si deja de hacerlo, expira). RLS solo permite leer presencia de amigos con `show_activity=true`.

## Schema

```sql
user_id           uuid PK → auth.users(id) ON DELETE CASCADE,
yt_id             text,
title             text,
artist            text,
cover_url         text,
duration_seconds  int,
position_seconds  int,
started_at        timestamptz,
expires_at        timestamptz NOT NULL,
updated_at        timestamptz
```

## TTL y limpieza

- TTL 2 min: la PWA hace upsert cada 30s mientras reproduce.
- Cron de Postgres cada 5 min limpia filas con `expires_at < now()`.
- RLS filter `expires_at > now()` excluye expiradas automáticamente.

## RLS

```sql
SELECT permitido si:
  - auth.uid() = user_id (propia), O
  - existe friendship 'accepted' entre auth.uid() y user_id
    AND target_profile.show_activity = true
    AND expires_at > now()
UPDATE/INSERT/DELETE: solo owner
```

## Realtime

Subscripción global (sin filtro de user_id) — la RLS filtra qué payloads recibe cada cliente. Ver [[use-social-realtime#canal-presence]].

## Cliente

- [[use-presence]] hook → publica cada 30s mientras reproduce.
- [[social]] store → `loadFriendsPresence`, `setFriendPresence`, `friendsPresence` Map.
- [[FriendsView]] tab `'friends'` muestra "Escuchando ahora".

## Notas / Changelog
- 2026-05-22: nivel simple.
