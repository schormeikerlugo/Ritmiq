-- Ritmiq — Fase C: cache de resolución álbum → tracks reproducibles.
--
-- Cuando el usuario abre/reproduce un álbum de la discografía, llamamos a
-- `album-resolve` que obtiene la tracklist de Last.fm y resuelve cada
-- track a un ytId vía Innertube. Cacheamos el resultado a perpetuidad
-- (TTL 7 días) — los tracklists de álbumes no cambian.

create table if not exists public.album_resolve_cache (
  cache_key     text primary key,        -- sha256(artist + '::' + album)
  artist        text not null,           -- normalizado lowercase
  album         text not null,           -- normalizado lowercase
  payload       jsonb not null,          -- { artist, album, tracks: [{title,ytId,duration,thumbnail}] }
  refreshed_at  timestamptz not null default now()
);

alter table public.album_resolve_cache enable row level security;
create policy "album_resolve: read public" on public.album_resolve_cache
  for select using (true);

create index if not exists idx_album_resolve_refreshed
  on public.album_resolve_cache(refreshed_at desc);
