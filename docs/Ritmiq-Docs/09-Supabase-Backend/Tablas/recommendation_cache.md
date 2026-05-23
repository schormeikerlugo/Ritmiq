---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260514000000_recommendations.sql
tags: [tabla, cache, lastfm, recomendaciones]
---

# `recommendation_cache` + `artist_detail_cache` + `album_resolve_cache`

> Caches server-side de las llamadas costosas (Last.fm + Innertube). Diferentes TTLs según volatilidad.

## `recommendation_cache`

```sql
user_id      uuid → auth.users(id),
kind         text,    -- 'similar-artist' | 'mix-by-track' | ...
seed         text,
payload      jsonb,
created_at   timestamptz,
PRIMARY KEY (user_id, kind, seed)
```

TTL: **12 horas**. Limpieza via cron (20260515).

## `artist_detail_cache`

```sql
name_norm    text PK,    -- lowercase + sin diacríticos
payload      jsonb,
created_at   timestamptz
```

TTL: **24 horas**.

## `album_resolve_cache`

```sql
key_sha256   text PK,    -- sha256(artist_lower + '::' + album_lower)
payload      jsonb,
created_at   timestamptz
```

TTL: **7 días** (los álbumes no cambian).

## RLS

- `recommendation_cache`: owner-only.
- `artist_detail_cache`, `album_resolve_cache`: público (datos no sensibles, compartibles entre usuarios).

## Por qué SHA256 como key en `album_resolve_cache`

Evita problemas de longitud/encoding con nombres de álbumes con caracteres especiales. Idempotente para "Café Tacvba — Re" vs "café tacvba::re".

## Edge Functions consumidoras

- [[recommendations]] → `recommendation_cache`.
- [[artist-detail]] → `artist_detail_cache`.
- [[album-resolve]] → `album_resolve_cache`.

## Notas / Changelog
- 2026-05-22: nivel simple.
