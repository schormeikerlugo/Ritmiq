-- Fix critico: refresh_user_streak() usaba `where id = v_user_id` para
-- consultar profiles, pero la columna PK de profiles es `user_id` (no
-- existe `id`). Resultado: la query lanzaba ERROR 42703 column does
-- not exist, el EXCEPTION WHEN OTHERS la capturaba como WARNING, y
-- el trigger devolvia NEW sin upsertar user_streaks.
--
-- Sintoma observable: usuarios reproducian canciones, play_history
-- insertaba normal, pero user_streaks.last_played_date NUNCA se
-- actualizaba a hoy. La card del Home mostraba estados 'danger'/
-- 'urgent' (12-18h sin play) aunque el user SI hubiera escuchado.
--
-- Fix: cambiar `where id = v_user_id` por `where user_id = v_user_id`.
-- Tambien forzamos un backfill de user_streaks recalculando con
-- compute_user_streak() para todos los users con plays, asi los que
-- estaban descuadrados vuelven a quedar coherentes.

create or replace function public.refresh_user_streak()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id      uuid := new.user_id;
  v_tz           text;
  v_today        date;
  v_streak       int;
  v_played_today boolean;
begin
  -- Timezone del profile, fallback a UTC. CORRECCION: la PK de profiles
  -- es `user_id`, no `id` (este era el bug original).
  select coalesce(timezone, 'UTC') into v_tz
  from public.profiles where user_id = v_user_id;

  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;

  select streak_days, played_today
  into v_streak, v_played_today
  from public.compute_user_streak(v_user_id);

  insert into public.user_streaks
    (user_id, current_streak, longest_streak, longest_at, last_played_date, updated_at)
  values
    (v_user_id, v_streak, v_streak, v_today, v_today, now())
  on conflict (user_id) do update set
    current_streak   = excluded.current_streak,
    longest_streak   = greatest(public.user_streaks.longest_streak, excluded.current_streak),
    longest_at       = case
                         when excluded.current_streak > public.user_streaks.longest_streak
                         then excluded.last_played_date
                         else public.user_streaks.longest_at
                       end,
    last_played_date = excluded.last_played_date,
    updated_at       = now();

  return new;
exception when others then
  raise warning 'refresh_user_streak fallo para user_id=% : %', v_user_id, sqlerrm;
  return new;
end;
$$;

-- ── Backfill: recalcular TODOS los user_streaks con el calculo real
-- de compute_user_streak. Las filas que quedaron desactualizadas por
-- el bug (con last_played_date viejo y current_streak mal) vuelven a
-- ser coherentes con play_history.
--
-- Estrategia: CTE intermedia que calcula los valores frescos, luego
-- UPDATE y INSERT (idempotentes) sobre user_streaks.

with fresh as (
  select
    ph.user_id,
    cus.streak_days as new_streak,
    (max(ph.played_at) at time zone coalesce(p.timezone, 'UTC'))::date as new_last_played
  from public.play_history ph
  left join public.profiles p on p.user_id = ph.user_id
  cross join lateral public.compute_user_streak(ph.user_id) cus
  group by ph.user_id, p.timezone, cus.streak_days
)
update public.user_streaks us
set
  current_streak   = f.new_streak,
  longest_streak   = greatest(us.longest_streak, f.new_streak),
  last_played_date = f.new_last_played,
  updated_at       = now()
from fresh f
where us.user_id = f.user_id;

-- Insertar users con plays pero sin fila aun en user_streaks (defensivo).
with fresh as (
  select
    ph.user_id,
    cus.streak_days as new_streak,
    (max(ph.played_at) at time zone coalesce(p.timezone, 'UTC'))::date as new_last_played
  from public.play_history ph
  left join public.profiles p on p.user_id = ph.user_id
  cross join lateral public.compute_user_streak(ph.user_id) cus
  group by ph.user_id, p.timezone, cus.streak_days
)
insert into public.user_streaks (user_id, current_streak, longest_streak, longest_at, last_played_date)
select user_id, new_streak, new_streak, new_last_played, new_last_played
from fresh
on conflict (user_id) do nothing;
