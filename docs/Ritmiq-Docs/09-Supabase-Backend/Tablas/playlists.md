---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260507000000_initial_schema.sql
tags: [tabla, playlists, rls]
---

# `playlists` + `playlist_tracks`

> Playlists del usuario + tabla de unión con `position` para orden.

## `playlists`

```sql
id          uuid PK,
user_id     uuid NOT NULL → auth.users(id) ON DELETE CASCADE,
name        text NOT NULL,
is_offline  boolean NOT NULL DEFAULT false,  -- Smart Download
cover_url   text,                             -- añadido en 20260508
created_at  timestamptz,
updated_at  timestamptz
```

Índice: `idx_playlists_user` ON `user_id`.

RLS: owner-only.

## `playlist_tracks` (tabla de unión)

```sql
playlist_id uuid NOT NULL → playlists(id) ON DELETE CASCADE,
track_id    uuid NOT NULL → tracks(id) ON DELETE CASCADE,
position    int NOT NULL,
PRIMARY KEY (playlist_id, track_id)
```

RLS: `"playlist_tracks: via playlist"` — acceso permitido si la `playlists.user_id` del playlist correspondiente coincide con `auth.uid()`.

## Cliente

- [[playlists]] store.
- [[PlaylistView]], [[Library]] componentes.

## Notas / Changelog
- 2026-05-22: schema inicial.
- 20260508: añadido `cover_url`.
