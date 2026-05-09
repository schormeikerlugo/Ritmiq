-- Ritmiq — schema inicial
-- Postgres + RLS por usuario. SQLite local (cliente) replica este schema con
-- tipos simplificados (TEXT en vez de UUID, INTEGER en vez de BOOLEAN).

create extension if not exists "pgcrypto";

-- ──────────────────────────────────────────────────────────────────────
-- tracks
-- ──────────────────────────────────────────────────────────────────────
create table public.tracks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  source            text not null check (source in ('youtube','local')),
  yt_id             text,
  title             text not null,
  artist            text,
  album             text,
  duration_seconds  int,
  cover_url         text,
  file_path         text,           -- solo significativo en cliente desktop
  is_downloaded     boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_tracks_user        on public.tracks(user_id);
create index idx_tracks_downloaded  on public.tracks(is_downloaded);
create unique index idx_tracks_yt_unique
  on public.tracks(user_id, yt_id) where yt_id is not null;

-- ──────────────────────────────────────────────────────────────────────
-- playlists
-- ──────────────────────────────────────────────────────────────────────
create table public.playlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  is_offline  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_playlists_user on public.playlists(user_id);

create table public.playlist_tracks (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id    uuid not null references public.tracks(id) on delete cascade,
  position    int  not null,
  primary key (playlist_id, track_id)
);

-- ──────────────────────────────────────────────────────────────────────
-- play_history
-- ──────────────────────────────────────────────────────────────────────
create table public.play_history (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  track_id  uuid references public.tracks(id) on delete set null,
  played_at timestamptz not null default now()
);

create index idx_play_history_user on public.play_history(user_id, played_at desc);

-- ──────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_tracks_updated     before update on public.tracks
  for each row execute function public.touch_updated_at();
create trigger trg_playlists_updated  before update on public.playlists
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ──────────────────────────────────────────────────────────────────────
alter table public.tracks          enable row level security;
alter table public.playlists       enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.play_history    enable row level security;

create policy "tracks: owner read"   on public.tracks
  for select using (auth.uid() = user_id);
create policy "tracks: owner write"  on public.tracks
  for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "playlists: owner read"  on public.playlists
  for select using (auth.uid() = user_id);
create policy "playlists: owner write" on public.playlists
  for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "playlist_tracks: via playlist" on public.playlist_tracks
  for all using (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_tracks.playlist_id and p.user_id = auth.uid()
    )
  );

create policy "play_history: owner" on public.play_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────
-- Storage: bucket de carátulas
-- ──────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

create policy "covers: public read" on storage.objects
  for select using (bucket_id = 'covers');

create policy "covers: owner write" on storage.objects
  for insert with check (bucket_id = 'covers' and auth.role() = 'authenticated');
