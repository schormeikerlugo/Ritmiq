---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-27
archivo: supabase/migrations/<ver historial>.sql
tags: [tabla, lastfm, cache, recommendations, artist_tags]
---

# `artist_tags`

> Cache global de top-tags (géneros) por artista vía Last.fm. Indexado por `artist` lowercase normalizado. Soporta el feature "Mix de [Género real]" del Home y la heurística mood-based de Fase 5.4. TTL implícito 30 días.

## Schema

```sql
create table public.artist_tags (
  artist       text primary key,           -- lowercase trim
  tags         text[] not null default '{}',
  refreshed_at timestamptz not null default now()
);
```

## Cómo se llena

Dos paths complementarios:

| Source | Cuándo |
|---|---|
| [[recommendations]] edge function | Lazy: cuando un usuario pide `auto-genre-mix` o `genre-mix`, llama `ensureArtistTags(artist)` internamente. Si miss, fetch Last.fm + UPSERT. |
| [[enrich-tags]] edge function | Pro-activo: cliente (`lib/enrich-tags.js`) o `pg_cron` (`cron_refresh_artist_tags`) llaman con un batch de artistas. |

## Cómo se lee

| Caller | Para qué |
|---|---|
| [[recommendations]] `auto-genre-mix` | Suma ponderada de tags por artistas top del usuario → genre dominante. |
| (futuro) | Si en el futuro el server devuelve `track.tags` en `RecTrack`, podemos derivar del autor del track. Hoy no. |

## RLS

```sql
alter table public.artist_tags enable row level security;

create policy "artist_tags_read"
  on public.artist_tags for select
  to authenticated
  using (true);
-- Sin policies de write: solo service_role escribe (vía edge functions).
```

## Tamaño esperado

- 1 fila por artista único que algún usuario haya tocado.
- Tags promedio: 3-5 strings cortos (~30 bytes).
- Con 10k artistas únicos: < 1 MB total. Despreciable.

## Por qué `artist` lowercase como PK

Last.fm devuelve `"Bad Bunny"` o `"bad bunny"` según el caller. Normalizar a `lowercase.trim()` antes de cualquier UPSERT evita duplicar el mismo artista con casing distinto. **Riesgo conocido**: artistas distintos con mismo nombre en minúsculas colisionan (raro).

## Cron de mantenimiento

`cron_refresh_artist_tags` (`pg_cron @ 04:15 UTC daily`) toma los top 30 artistas con más plays en los últimos 7 días de `play_history` y llama a [[enrich-tags]] vía `pg_net` POST. Mantiene fresh el cache para el `auto-genre-mix` matutino sin esperar a Last.fm.

## Qué puede romper este cambio

| Cambio | Impacto |
|---|---|
| Quitar la normalización a lowercase en el UPSERT | Duplicados con diferente casing |
| Bajar el TTL a 7 días | Spam a Last.fm; rate limits |
| Agregar columna `popularity` sin migración con default | INSERT existentes fallan |

## Migration history

Existe desde antes del registro `schema_migrations`. La tabla fue creada en una migración temprana (anterior a 2026-05-22). El refactor a tags filtrados (`isAllowedTag`, `TAG_BLACKLIST`) llegó en `recommendations` Fase 2.

## Changelog

- 2026-05-27 — Documentada retroactivamente. Fase 5 añade el endpoint [[enrich-tags]] dedicado + cron de refresh nocturno.
