-- Ritmiq — Fase 2: recomendaciones basadas en Last.fm.
--
-- Dos tablas de cache:
--   artist_tags          → top-tags de Last.fm por artista (=género inferido).
--   recommendation_cache → payload JSON de la respuesta de la Edge Function
--                          recommendations, keyed por (user_id, kind, seed).
-- Ambas son globales (sin RLS sobre artist_tags, RLS por user en cache).

create table if not exists public.artist_tags (
  artist        text primary key,
  tags          text[]      not null default '{}',
  refreshed_at  timestamptz not null default now()
);

-- Las tags son contenido público de Last.fm. No vinculado a usuarios, sin RLS.
alter table public.artist_tags enable row level security;
create policy "artist_tags: read public" on public.artist_tags
  for select using (true);
-- Solo la edge function (service role) puede escribir → no exponemos write.

create table if not exists public.recommendation_cache (
  cache_key     text primary key,           -- hash(user_id + kind + seed)
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null,              -- 'similar-artist', 'mix-by-track', 'genre-mix', 'discover'
  seed          text,                       -- artist/track/tag opcional
  payload       jsonb not null,             -- { tracks: [{ytId,title,...}], reason, ... }
  refreshed_at  timestamptz not null default now()
);

create index if not exists idx_reccache_user on public.recommendation_cache(user_id, kind);

alter table public.recommendation_cache enable row level security;
create policy "rec_cache: owner" on public.recommendation_cache
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
