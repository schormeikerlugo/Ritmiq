---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260507000000_initial_schema.sql
tags: [storage, buckets, covers, avatars]
---

# Storage Buckets

> Buckets de Supabase Storage para imágenes públicas.

## `covers`

Portadas de tracks (de YouTube, normalmente URLs externas — pero hay uso futuro para covers locales).

```sql
public: true
RLS:
  - covers: public read   (SELECT bucket_id = 'covers')
  - covers: owner write   (INSERT auth.role() = 'authenticated')
```

## `playlist-covers`

Portadas custom de playlists subidas por el usuario.

```sql
public: true
Path: <userId>/<playlistId>-<timestamp>.<ext>
RLS:
  - owner write: INSERT WHERE auth.uid() = (path[0]::uuid)
```

Cliente: [[storage|ui/lib/storage]] → `uploadPlaylistCover`.

## `avatars`

Avatares de usuarios (`profiles.avatar_url`).

```sql
public: true
Path: <user_id>/avatar.<jpg|png|webp>
upsert: true                    (sobrescribe el anterior al subir)
cacheControl: 3600              (1 hora)
RLS: solo owner para INSERT/UPDATE/DELETE
```

Cache buster `?v=<timestamp>` añadido en la URL pública por [[social#uploadAvatar]] para que los amigos vean el cambio inmediato sin esperar el TTL del CDN.

## Migraciones relacionadas

- `20260507`: bucket `covers`.
- `20260508_playlist_covers`: bucket `playlist-covers`.
- `20260522000000_avatars_bucket`: bucket `avatars` con RLS de path-based.

## Notas / Changelog
- 2026-05-22: nivel simple. Agrupa los 3 buckets en una sola nota.
