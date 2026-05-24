---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-24
archivo: supabase/migrations/20260524000005_tracks_global.sql
tags: [supabase, tabla, p2p, knowledge-base]
created: 2026-05-24
migration: 20260524000005_tracks_global.sql
---

# tracks_global — Diccionario público de metadata

> **RLS:** `any auth read` · Write solo via service_role (Edge Function)
> **Filas iniciales:** 348 (backfill desde SQLite local del dev)
> **Edge writer:** [[publish-track-meta]]
> **Edge reader:** [[search-youtube]] (paso 0 known lookup)

## Propósito

Diccionario público y compartido de metadata de tracks. Cada reproducción exitosa de cualquier usuario contribuye una entrada al diccionario (anónimamente). La búsqueda inteligente lo consulta antes que Innertube → tracks ya canonizados aparecen primero con badge `✨ Conocida en Ritmiq`.

A medida que crece el uso, más tracks conocidos → búsqueda más rápida y limpia → mejor experiencia para todos.

## Schema

```sql
create table public.tracks_global (
  yt_id              text primary key,
  title              text not null,
  artist             text not null,
  album              text,
  cover_url          text,
  duration_seconds   integer,
  first_seen_at      timestamptz default now(),
  last_seen_at       timestamptz default now(),
  contribution_count integer default 1
);
```

## Indices

```sql
-- Lookups por prefijo/substring (case-insensitive):
create index idx_tracks_global_title_lower  on tracks_global (lower(title));
create index idx_tracks_global_artist_lower on tracks_global (lower(artist));

-- FTS combinado titulo + artista (diccionario 'simple' = sin filtros):
create index idx_tracks_global_fts on tracks_global
  using gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(artist,'')));

-- Top-N por popularidad:
create index idx_tracks_global_popular on tracks_global (contribution_count desc);
```

## RLS

```sql
alter table public.tracks_global enable row level security;

create policy "tracks_global: any auth read"
  on public.tracks_global
  for select
  using (auth.role() = 'authenticated');
```

INSERT/UPDATE/DELETE quedan implícitamente denegados a clientes; solo el `service_role` desde [[publish-track-meta]] puede escribir.

## Canonicalización (first-write-wins)

- La **PRIMERA** contribución por `yt_id` define `title`, `artist`, `album`, `cover_url`, `duration_seconds`.
- Las contribuciones subsecuentes **solo** incrementan `contribution_count` y refrescan `last_seen_at`.
- Esto evita que un usuario con metadata mal formateada pise la versión canonizada.

**Defensa contra basura:** todas las inserts pasan por [[clean-track-meta]] antes de canonizar, en dos capas:
1. [[search-youtube]] limpia en la raíz (lo que el cliente publica ya viene limpio).
2. [[publish-track-meta]] re-limpia defensivamente antes del INSERT.

## Privacidad

- **NO contiene `user_id`, IP, timestamp con granularidad menor a segundo.**
- `contribution_count` es agregado anónimo.
- Solo metadata pública de YouTube (título, artista, cover, duración).
- Mismo riesgo de privacidad que [[stream_url_cache]] que lleva semanas en producción sin incidentes.

## Triggers de publicación

Un nuevo INSERT/incremento se dispara desde:

1. **PWA / Desktop renderer — tras `backend.play()` exitoso**
   `packages/ui/src/lib/use-player.js` → `publishTrackMeta(track)` fire-and-forget tras play() OK. Dedupe por sesión via Set in-memory.

2. **Desktop main — tras descarga completa con yt-dlp**
   `apps/desktop/main/lan-server.js` → `publishTrackMetaFromMain(meta)` invocado desde `ipc.js` library:download. Señal MUY fuerte (el user invirtió disco).

## Backfill inicial (2026-05-24)

Script `scripts/wipe-and-rebackfill-tracks-global.mjs`:
- Lee SQLite local del desktop: `tracks WHERE is_downloaded=1`.
- Aplica [[clean-track-meta]] a cada fila.
- DELETE FROM tracks_global; luego INSERT en batches de 10.

Resultado del primer run:
- 348 tracks descargados.
- 169 cambios detectados (49% necesitaba cleaning).
- 348/348 inserts OK, 0 fallos.

## Queries útiles

```sql
-- Cuántas canciones conoce Ritmiq?
SELECT COUNT(*) FROM tracks_global;

-- Top 20 más populares:
SELECT yt_id, title, artist, contribution_count
FROM tracks_global
ORDER BY contribution_count DESC
LIMIT 20;

-- Búsqueda por texto (igual lógica que search-youtube hace):
SELECT yt_id, title, artist, contribution_count
FROM tracks_global
WHERE title ILIKE '%linkin%'
   OR artist ILIKE '%linkin%'
ORDER BY contribution_count DESC
LIMIT 10;

-- Recientemente añadidas:
SELECT yt_id, title, artist, first_seen_at
FROM tracks_global
ORDER BY first_seen_at DESC
LIMIT 20;
```

## Lo que NO está aún (planeado futuro)

- **Tabla `tracks_popularity`** con `unique_listeners_30d` — diferido hasta tener >100 usuarios activos (riesgo de deanonimización en base pequeña).
- **Trending temporal** — mismo motivo.
- **Cron de prune** — la metadata no caduca; una canción sigue siendo válida años después.

## Cross-references

- [[clean-track-meta]] — utility canónica de limpieza
- [[publish-track-meta]] — Edge writer
- [[search-youtube]] — Edge reader (paso 0)
- [[stream_url_cache]] — primo URL-cache (Fase 1)
- [[p2p-knowledge-sharing]] — flujo completo
