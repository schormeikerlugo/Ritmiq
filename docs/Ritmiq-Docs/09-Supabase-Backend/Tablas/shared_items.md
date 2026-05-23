---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260521000002_shared_items.sql
tags: [tabla, social, share, inbox]
---

# `shared_items`

> Items compartidos entre amigos (tracks y playlists). Cada fila = 1 share, con metadata para que el receptor pueda reproducir sin depender del sender.

## Schema

```sql
id                  uuid PK,
sender_id           uuid → auth.users(id),
receiver_id         uuid → auth.users(id),
kind                text CHECK (kind IN ('track','playlist')),
-- Track fields
yt_id               text,
title               text,
artist              text,
cover_url           text,
duration_seconds    int,
-- Playlist fields
playlist_name       text,
playlist_snapshot   jsonb,        -- { tracks: [...] }
-- Common
message             text,
read_at             timestamptz,
saved_at            timestamptz,
played_at           timestamptz,
created_at          timestamptz NOT NULL DEFAULT now()
```

## Por qué snapshot para playlists

El `playlist_snapshot` contiene la lista completa de tracks al momento del share. Permite:
- Que el receptor reproduzca aunque la playlist original cambie.
- Que pueda guardarla como playlist propia con los tracks exactos del momento.

## RLS

- SELECT: sender o receiver.
- INSERT: requiere ser amigo del receiver (validado en [[send-share]] Edge Function).
- UPDATE: solo receiver (marcar read/saved/played).

## Realtime

Suscribible vía Realtime con filtro `receiver_id = user.id`. Ver [[use-social-realtime]].

## Cliente

- [[social]] store → `loadInbox`, `markInboxItemRead/Saved`, `sendShare`.
- [[FriendsView]] tab `'inbox'`.

## Notas / Changelog
- 2026-05-22: nivel simple.
