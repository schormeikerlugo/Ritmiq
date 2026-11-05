-- Portadas oficiales y fotos de artista por canción (2026-11-05).
--
-- El servidor 24/7 identifica cada canción de YouTube (título limpio +
-- iTunes/Deezer, ver packages/server-core/src/art-resolver.js) y guarda aquí
-- el resultado para que TODOS los dispositivos usen la portada oficial (CDN)
-- sin repetir la búsqueda. También los "no encontrado" (status 'none'), para
-- no volver a pedirlos.
--
-- Escritura: solo cuentas de servidor (prefetch_principals, donde ya está
-- servidor@ritmiq.org). Lectura: cualquier usuario autenticado.
-- Las portadas puestas a mano siguen en tracks.cover_url (por usuario).
--
-- Idempotente.

create table if not exists public.track_art (
  yt_id            text primary key,
  status           text not null check (status in ('found', 'none')),
  source           text,
  score            real,
  matched_title    text,
  matched_artist   text,
  album            text,
  cover_url        text,
  cover_small_url  text,
  artist_image_url text,
  updated_at       timestamptz not null default now()
);

alter table public.track_art enable row level security;

drop policy if exists "track_art: read" on public.track_art;
create policy "track_art: read"
  on public.track_art for select
  to authenticated
  using (true);

-- prefetch_principals tiene RLS sin lectura: comprobar con security definer.
create or replace function public.is_art_writer()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.prefetch_principals p where p.user_id = auth.uid());
$$;
revoke all on function public.is_art_writer() from public, anon;
grant execute on function public.is_art_writer() to authenticated;

drop policy if exists "track_art: server insert" on public.track_art;
create policy "track_art: server insert"
  on public.track_art for insert
  to authenticated
  with check (public.is_art_writer());

drop policy if exists "track_art: server update" on public.track_art;
create policy "track_art: server update"
  on public.track_art for update
  to authenticated
  using (public.is_art_writer())
  with check (public.is_art_writer());

comment on table public.track_art is
  'Portada oficial (iTunes/Deezer) y foto de artista por yt_id, resueltas por el servidor. status none = no se encontró.';

-- Canciones de bibliotecas/historial SIN entrada en track_art (para la pasada
-- periódica del servidor). Escuchadas recientemente primero.
create or replace function public.get_art_targets(p_limit int default 200)
returns table (yt_id text, title text, artist text, duration_seconds int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with allowed as (
    select 1 from public.prefetch_principals where user_id = auth.uid()
  ),
  plays as (
    select ph.yt_id, count(*) as n
    from public.play_history ph
    where ph.yt_id ~ '^[A-Za-z0-9_-]{11}$' and ph.played_at > now() - interval '60 days'
    group by ph.yt_id
  ),
  lib as (
    select distinct on (t.yt_id) t.yt_id, t.title, t.artist, t.duration_seconds
    from public.tracks t
    where t.yt_id ~ '^[A-Za-z0-9_-]{11}$' and t.title is not null
      and coalesce(t.duration_seconds, 0) <= 1800
    order by t.yt_id, coalesce(t.updated_at, t.created_at) desc
  )
  select l.yt_id, l.title, l.artist, l.duration_seconds
  from lib l
  left join plays p on p.yt_id = l.yt_id
  where exists (select 1 from allowed)
    and not exists (select 1 from public.track_art a where a.yt_id = l.yt_id)
  order by coalesce(p.n, 0) desc, l.yt_id
  limit greatest(1, least(p_limit, 1000));
$$;

revoke all on function public.get_art_targets(int) from public, anon;
grant execute on function public.get_art_targets(int) to authenticated;
