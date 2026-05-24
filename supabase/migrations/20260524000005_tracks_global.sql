-- ════════════════════════════════════════════════════════════════════════
-- FASE: Diccionario global de metadata de tracks (P2P knowledge sharing).
--
-- Objetivo: cada reproduccion exitosa publica el snapshot del track al
-- diccionario publico tracks_global. Cuando otro user busca, su query
-- se resuelve PRIMERO contra este diccionario antes de Innertube, asi
-- las canciones que la comunidad ya canonizo se muestran arriba con
-- metadata consistente. A medida que crece el uso, mas tracks conocidos
-- → mas rapida y limpia la busqueda.
--
-- PRIVACIDAD
--   - Sin user_id, sin IP, sin timestamps de minuto.
--   - Solo metadata publica de YouTube (titulo, artista, cover, duracion).
--   - Counter agregado (contribution_count) sin posibilidad de inferir
--     usuarios individuales (k-anonimato natural por compartirse).
--   - Mismo patron de RLS que stream_url_cache (any auth read,
--     write only via service_role en Edge Function).
--
-- CANONICALIZACION
--   La PRIMERA contribucion por yt_id define title/artist/album/cover.
--   Subsecuentes solo incrementan contribution_count y refrescan
--   last_seen_at. Esto evita que un usuario con metadata mala (ej.
--   titulo mal formateado) pise lo que ya esta canonizado.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.tracks_global (
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

-- Indices para busqueda eficiente:

-- 1. Lookup por titulo (LIKE/ILIKE con prefijo o substring).
create index if not exists idx_tracks_global_title_lower
  on public.tracks_global (lower(title));

-- 2. Lookup por artista (mismo patron).
create index if not exists idx_tracks_global_artist_lower
  on public.tracks_global (lower(artist));

-- 3. FTS combinado titulo + artista. Usa diccionario 'simple' para
--    soportar cualquier idioma sin filtrar stopwords (musica suele
--    tener titulos con stopwords significativas: "Yo", "Tu", "De", etc).
create index if not exists idx_tracks_global_fts
  on public.tracks_global
  using gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(artist, '')));

-- 4. Top-N por popularidad (sirve para "trending" en SearchView vacio).
create index if not exists idx_tracks_global_popular
  on public.tracks_global (contribution_count desc);

-- RLS: cualquier authenticated lee; solo service_role escribe via Edge.

alter table public.tracks_global enable row level security;

drop policy if exists "tracks_global: any auth read" on public.tracks_global;
create policy "tracks_global: any auth read"
  on public.tracks_global
  for select
  using (auth.role() = 'authenticated');

-- INSERT/UPDATE/DELETE quedan implicitamente denegados a clientes;
-- la Edge Function publish-track-meta usa service_role para escribir.

comment on table  public.tracks_global is
  'Diccionario publico de metadata de tracks contribuida por usuarios al reproducir. RLS any auth read, write solo via Edge publish-track-meta.';
comment on column public.tracks_global.contribution_count is
  'Counter agregado anonimo. Numero de veces que un user reprodujo este yt_id desde cualquier device.';
comment on column public.tracks_global.first_seen_at is
  'Cuando se vio por primera vez en Ritmiq (canonizacion).';
comment on column public.tracks_global.last_seen_at is
  'Ultima reproduccion registrada. Util para "fresco" vs "olvidado".';
