-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  Ritmiq — Migraciones combinadas para Supabase Cloud             ║
-- ║  Aplicar UNA SOLA VEZ desde Studio SQL Editor                    ║
-- ╚══════════════════════════════════════════════════════════════════╝


-- ═══ MIGRATION 1: Initial schema ═══════════════════════════════════
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

-- ═══ MIGRATION 2: Playlist covers ═════════════════════════════════
-- Ritmiq — añadir portadas personalizables a playlists.

alter table public.playlists
  add column if not exists cover_url text;

-- Bucket para portadas de playlists (público en lectura).
insert into storage.buckets (id, name, public)
values ('playlist-covers', 'playlist-covers', true)
on conflict (id) do nothing;

create policy "playlist-covers: public read"
  on storage.objects for select
  using (bucket_id = 'playlist-covers');

create policy "playlist-covers: authenticated insert"
  on storage.objects for insert
  with check (bucket_id = 'playlist-covers' and auth.role() = 'authenticated');

create policy "playlist-covers: owner update"
  on storage.objects for update
  using (bucket_id = 'playlist-covers' and auth.uid() = owner);

create policy "playlist-covers: owner delete"
  on storage.objects for delete
  using (bucket_id = 'playlist-covers' and auth.uid() = owner);

-- ═══ MIGRATION 3: Realtime ════════════════════════════════════════
-- Ritmiq — habilitar Realtime en las tablas de dominio.
-- Necesario para que supabase-js reciba eventos de INSERT/UPDATE/DELETE.

-- REPLICA IDENTITY FULL hace que UPDATE y DELETE incluyan la fila completa
-- en el log de replicación; sin esto, los eventos no traerían datos útiles.
alter table public.tracks          replica identity full;
alter table public.playlists       replica identity full;
alter table public.playlist_tracks replica identity full;

-- Añadir las tablas a la publicación que Realtime escucha.
-- Idempotente: la publicación 'supabase_realtime' ya existe en cualquier
-- proyecto Supabase. Solo añadimos las tablas que aún no estén.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tracks'
  ) then
    alter publication supabase_realtime add table public.tracks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'playlists'
  ) then
    alter publication supabase_realtime add table public.playlists;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'playlist_tracks'
  ) then
    alter publication supabase_realtime add table public.playlist_tracks;
  end if;
end $$;
