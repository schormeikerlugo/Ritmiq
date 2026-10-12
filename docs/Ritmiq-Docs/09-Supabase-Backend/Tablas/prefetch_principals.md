---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-10-12
archivo: supabase/migrations/20261012000100_library_prefetch.sql
tags:
  - tabla
  - servidor
  - prefetch
  - cache
---

# `prefetch_principals` + `get_prefetch_targets()`

> Cuentas autorizadas a pedir la lista de canciones que el servidor 24/7 pre-descarga a `shared-audio`.

## Schema

```sql
user_id    uuid PK → auth.users ON DELETE CASCADE,
note       text,
created_at timestamptz NOT NULL DEFAULT now()
```

RLS activada **sin policies**: nadie la lee/escribe desde el cliente. Contiene la cuenta de servicio `servidor@ritmiq.org`.

## `get_prefetch_targets(p_limit int default 3000)`

`security definer`, `authenticated`. Devuelve `(yt_id, priority)` solo si `auth.uid()` está en `prefetch_principals` (cualquier otra cuenta recibe 0 filas). No expone usuarios ni metadata.

- `priority 0`: escuchadas en los últimos 60 días (más escuchadas primero).
- `priority 1`: resto de `tracks` de todas las bibliotecas (incluye favoritas y playlists), más recientes primero.
- Excluye > 30 min. Orden estable (desempate por `yt_id`) para paginar: PostgREST corta en 1000 filas.

## Consumidor

`apps/server/src/endpoint-registry.js` `fetchPrefetchTargets()` → `lan.prefetch()`. Ver [[Cache-y-Rendimiento]].

## Notas / Changelog
- 2026-10-12: creación (ADR-039). 1096 canciones objetivo al lanzarse.
