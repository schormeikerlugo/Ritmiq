---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260507000000_initial_schema.sql
tags: [tabla, tracks, biblioteca, rls]
---

# `tracks`

> Biblioteca de tracks por usuario. RLS owner-only.

## Schema

```sql
id                uuid PK default gen_random_uuid(),
user_id           uuid NOT NULL → auth.users(id) ON DELETE CASCADE,
source            text NOT NULL CHECK (source IN ('youtube','local')),
yt_id             text,
title             text NOT NULL,
artist            text,
album             text,
duration_seconds  int,
cover_url         text,
file_path         text,                         -- solo cliente Desktop
is_downloaded     boolean NOT NULL DEFAULT false,
created_at        timestamptz NOT NULL DEFAULT now(),
updated_at        timestamptz NOT NULL DEFAULT now()
```

## Índices

- `idx_tracks_user` ON `user_id`
- `idx_tracks_downloaded` ON `is_downloaded`
- **UNIQUE** `idx_tracks_yt_unique` ON `(user_id, yt_id)` WHERE `yt_id IS NOT NULL`

## RLS

```sql
"tracks: owner read"   USING (auth.uid() = user_id)
"tracks: owner write"  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)
```

## Trigger `updated_at`

```sql
BEFORE UPDATE: touch_updated_at() → new.updated_at := now()
```

## Cliente

- [[library]] store (UI).
- [[sqlite-adapter]] en Desktop (espejo local).
- [[dexie-adapter]] en PWA (cache local).

## Notas / Changelog
- 2026-05-22: tabla del schema inicial.
