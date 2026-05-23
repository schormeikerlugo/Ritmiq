---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260521000000_profiles.sql
tags: [tabla, perfil, social, timezone]
---

# `profiles`

> Perfil público de cada usuario. Username único, display name editable, avatar, bio, flag `show_activity`, timezone.

## Schema

```sql
user_id        uuid PK → auth.users(id) ON DELETE CASCADE,
username       text NOT NULL UNIQUE,
display_name   text,
avatar_url     text,
bio            text,
show_activity  boolean NOT NULL DEFAULT true,
timezone       text DEFAULT 'UTC',           -- añadido en 20260523000001
created_at     timestamptz NOT NULL DEFAULT now()
```

## Username constraints

- `UNIQUE`.
- Regex enforce a nivel cliente: `^[a-z0-9_]+$`, 3–24 chars.

## Trigger de creación

Trigger `on_auth_user_created` que crea automáticamente un perfil al insertar en `auth.users`:
- Lee `user_metadata.username` y `display_name` si están presentes.
- Si no, genera username `user_<8chars_uid>`.

## RLS

- SELECT público (cualquiera puede leer un perfil — necesario para shared/social).
- UPDATE solo owner.

## Cliente

- [[social]] store → `loadProfile`, `updateProfile`, `uploadAvatar`, `removeAvatar`.
- [[EditProfileDialog]] componente.

## Migraciones relacionadas

- `20260521000000_profiles.sql` — schema inicial.
- `20260522000000_avatars_bucket.sql` — bucket Storage para avatares.
- `20260523000001_profiles_timezone.sql` — añade columna `timezone`.

## Notas / Changelog
- 2026-05-22: nivel simple.
