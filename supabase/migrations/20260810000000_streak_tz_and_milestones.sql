-- Fix racha + trofeos granulares (2026-08-10):
--
--   1. BUG #1 (timezone): compute_user_streak() calculaba los dias con
--      current_date (zona del proyecto = UTC), pero refresh_user_streak()
--      grababa last_played_date en la timezone del PERFIL del usuario. Dos
--      calendarios distintos -> para un usuario en UTC-4 una escucha
--      nocturna (21:00 local = 01:00 UTC del dia siguiente) caia en dias
--      diferentes segun que funcion la mirara, y la racha se rompia aunque
--      el usuario escuchara a diario.
--
--      Fix: compute_user_streak() ahora deriva la timezone del profile y
--      calcula "hoy" y las comparaciones played_at CON esa timezone, igual
--      que refresh_user_streak(). Ambas quedan alineadas al dia LOCAL del
--      usuario.
--
--   2. BUG #4 (trofeos granulares): estrategia hibrida progresiva. Arranque
--      frecuente (3, 7, 14) + un trofeo CADA 30 DIAS hasta el ano
--      (30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 365) +
--      legendarios espaciados (500, 730 = 2 anos, 1000). Mantiene la
--      motivacion todo el ano.
--
-- Idempotente. Incluye backfill de user_streaks (con tz correcta) y de
-- streak_milestones (para que los trofeos ya alcanzados aparezcan).

-- ──────────────────────────────────────────────────────────────────────
-- 1. compute_user_streak con timezone del perfil
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.compute_user_streak(p_user_id uuid)
returns table (streak_days int, played_today boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz             text;
  v_today          date;
  v_played_today   boolean;
  v_streak         int := 0;
  v_check_date     date;
  v_has_play       boolean;
begin
  -- Timezone del perfil (fallback UTC). Alinea el calendario de la racha
  -- con refresh_user_streak() y con lo que el usuario percibe como "hoy".
  select coalesce(timezone, 'UTC') into v_tz
  from public.profiles where user_id = p_user_id;
  v_tz := coalesce(v_tz, 'UTC');

  v_today := (now() at time zone v_tz)::date;

  -- 1. ¿Ya escucho hoy? (comparando played_at en la tz del usuario)
  select exists(
    select 1 from public.play_history
    where user_id = p_user_id
      and (played_at at time zone v_tz)::date = v_today
  ) into v_played_today;

  -- 2. Contar racha: empezar desde hoy (si escucho) o ayer (si no) e ir
  --    hacia atras hasta el primer dia LOCAL sin play.
  v_check_date := case when v_played_today then v_today else v_today - 1 end;

  loop
    select exists(
      select 1 from public.play_history
      where user_id = p_user_id
        and (played_at at time zone v_tz)::date = v_check_date
    ) into v_has_play;

    exit when not v_has_play;
    v_streak := v_streak + 1;
    v_check_date := v_check_date - 1;
    -- Safety: no contar mas de 365 dias hacia atras.
    exit when v_streak >= 365;
  end loop;

  return query select v_streak, v_played_today;
end;
$$;

comment on function public.compute_user_streak(uuid) is
  'Calcula racha de dias consecutivos escuchando musica + flag si ya escucho hoy, usando la timezone del perfil del usuario (dia LOCAL). Usado por refresh_user_streak y por la Edge Function streak-reminder.';

-- ──────────────────────────────────────────────────────────────────────
-- 1b. Backfill de user_streaks con el calculo tz-correcto. Restaura las
--     rachas que se rompieron por el desfase de timezone.
-- ──────────────────────────────────────────────────────────────────────

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

-- ──────────────────────────────────────────────────────────────────────
-- 2. Trofeos granulares: estrategia hibrida (cada 30 dias hasta el ano)
-- ──────────────────────────────────────────────────────────────────────

alter table public.streak_milestones
  drop constraint if exists streak_milestones_milestone_check;

-- El CHECK incluye los umbrales NUEVOS (estrategia hibrida) + los LEGACY
-- (50, 100, 200) que algunos usuarios ya desbloquearon con la estrategia
-- anterior. Asi no se pierden logros historicos aunque el trigger ya no
-- otorgue los legacy a usuarios nuevos.
alter table public.streak_milestones
  add constraint streak_milestones_milestone_check
  check (milestone in (
    3, 7, 14,
    30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 365,
    500, 730, 1000,
    50, 100, 200
  ));

create or replace function public.check_streak_milestones()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_milestone int;
  v_old       int;
begin
  v_old := coalesce(old.current_streak, 0);

  foreach v_milestone in array array[
    3, 7, 14,
    30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 365,
    500, 730, 1000
  ] loop
    if new.current_streak >= v_milestone and v_old < v_milestone then
      insert into public.streak_milestones (user_id, milestone, streak_value)
      values (new.user_id, v_milestone, new.current_streak)
      on conflict do nothing;
    end if;
  end loop;

  return new;
exception when others then
  raise warning 'check_streak_milestones fallo para user_id=% : %', new.user_id, sqlerrm;
  return new;
end;
$$;

-- Backfill: insertar todos los trofeos que el usuario YA alcanzo segun su
-- mejor racha historica (longest_streak), para que aparezcan retroactivos.
insert into public.streak_milestones (user_id, milestone, streak_value)
select us.user_id, m.val, us.longest_streak
from public.user_streaks us
cross join (values
  (3), (7), (14),
  (30), (60), (90), (120), (150), (180), (210), (240), (270), (300), (330), (365),
  (500), (730), (1000)
) as m(val)
where us.longest_streak >= m.val
on conflict do nothing;
