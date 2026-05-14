-- Ritmiq — Fase B: cache de detalles de artista para la página /artist.
--
-- artist_detail_cache: respuesta JSON completa de `artist-detail` por nombre.
-- Datos públicos compartidos entre todos los usuarios → sin RLS-por-owner.
-- TTL de 24h se evalúa en la edge function (no en cron) para mantenerlo simple.

create table if not exists public.artist_detail_cache (
  name          text primary key,                    -- nombre normalizado (lowercase, trimmed)
  payload       jsonb not null,                      -- { name, bio, image, tags, topTracks, albums, ... }
  refreshed_at  timestamptz not null default now()
);

alter table public.artist_detail_cache enable row level security;
create policy "artist_detail: read public" on public.artist_detail_cache
  for select using (true);
-- Solo service role escribe (la edge function).

create index if not exists idx_artist_detail_refreshed
  on public.artist_detail_cache(refreshed_at desc);
