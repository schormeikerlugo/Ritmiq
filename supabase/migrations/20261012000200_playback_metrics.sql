-- Telemetría de "tiempo hasta que suena" (2026-10-12):
--
-- El cliente mide desde que pide reproducir una canción hasta el evento
-- 'playing' del <audio> (o el error) y lo inserta aquí. Sirve para comprobar
-- con datos reales cada mejora de reproducción (prefetch, descarga
-- progresiva, InnerTube...). El desglose de caché lo da el log del servidor.
--
-- Idempotente.

create table if not exists public.playback_metrics (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  yt_id       text,
  ms_to_play  int not null check (ms_to_play between 0 and 600000),
  origin      text,   -- server | lan | tunnel | cloud | local
  platform    text,   -- ios | android | desktop | web
  outcome     text not null default 'playing' check (outcome in ('playing', 'error')),
  created_at  timestamptz not null default now()
);

create index if not exists playback_metrics_created_idx on public.playback_metrics (created_at desc);

alter table public.playback_metrics enable row level security;

drop policy if exists "playback_metrics: owner insert" on public.playback_metrics;
create policy "playback_metrics: owner insert"
  on public.playback_metrics for insert
  with check (auth.uid() = user_id);

drop policy if exists "playback_metrics: owner read" on public.playback_metrics;
create policy "playback_metrics: owner read"
  on public.playback_metrics for select
  using (auth.uid() = user_id);

comment on table public.playback_metrics is
  'Tiempo desde pedir reproducir hasta que suena (cliente). Insert/read solo del dueño.';
