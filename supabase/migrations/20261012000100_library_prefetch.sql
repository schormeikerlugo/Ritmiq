-- Prefetch de bibliotecas en el servidor 24/7 (2026-10-12):
--
-- El 87% de las reproducciones son canciones que el usuario ya escuchó,
-- pero solo el 23% salía del disco del servidor. El servidor ahora descarga
-- por adelantado (shared-audio) todo lo que hay en las bibliotecas
-- (tracks: incluye favoritas y playlists, que referencian tracks) y en el
-- historial reciente de TODOS los usuarios.
--
-- El servidor se autentica con una cuenta de servicio sin privilegios, y RLS
-- le impide leer bibliotecas ajenas. Esta función security definer devuelve
-- solo los yt_id (sin usuario ni metadata) y únicamente a las cuentas
-- listadas en prefetch_principals.
--
-- Idempotente.

create table if not exists public.prefetch_principals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note    text,
  created_at timestamptz not null default now()
);

alter table public.prefetch_principals enable row level security;
-- Sin policies: nadie la lee ni escribe desde el cliente.

comment on table public.prefetch_principals is
  'Cuentas (servidor 24/7) autorizadas a llamar get_prefetch_targets().';

insert into public.prefetch_principals (user_id, note)
select id, 'servidor 24/7 (cuenta de servicio)'
from auth.users where email = 'servidor@ritmiq.org'
on conflict (user_id) do nothing;

-- Orden de prioridad:
--   0. Escuchadas en los últimos 60 días (más escuchadas primero).
--   1. Resto de bibliotecas (añadidas/actualizadas más recientes primero).
-- Excluye contenidos > 30 min (mixes/podcasts), igual que el prewarm.
create or replace function public.get_prefetch_targets(p_limit int default 3000)
returns table (yt_id text, priority int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with allowed as (
    select 1 from public.prefetch_principals where user_id = auth.uid()
  ),
  plays as (
    select ph.yt_id, count(*) as n, max(ph.played_at) as last_at
    from public.play_history ph
    where ph.yt_id ~ '^[A-Za-z0-9_-]{11}$'
      and ph.played_at > now() - interval '60 days'
      and coalesce(ph.duration_seconds, 0) <= 1800
    group by ph.yt_id
  ),
  lib as (
    select t.yt_id, max(coalesce(t.updated_at, t.created_at)) as last_at
    from public.tracks t
    where t.yt_id ~ '^[A-Za-z0-9_-]{11}$'
      and coalesce(t.duration_seconds, 0) <= 1800
    group by t.yt_id
  ),
  merged as (
    select yt_id, 0 as prio, n, last_at from plays
    union all
    select yt_id, 1 as prio, 0 as n, last_at from lib
  )
  select m.yt_id, min(m.prio)::int as priority
  from merged m
  where exists (select 1 from allowed)
  group by m.yt_id
  order by min(m.prio), max(m.n) desc, max(m.last_at) desc nulls last, m.yt_id
  limit greatest(1, least(p_limit, 10000));
$$;

revoke all on function public.get_prefetch_targets(int) from public, anon;
grant execute on function public.get_prefetch_targets(int) to authenticated;
