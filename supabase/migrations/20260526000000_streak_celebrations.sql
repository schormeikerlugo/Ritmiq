-- Sistema completo de celebracion de racha (2026-05-26):
--
--   1. user_streaks: nueva columna last_daily_celebrated_date para
--      sincronizar cross-device el "ya mostre el toast diario hoy".
--   2. streak_milestones: extender CHECK constraint con hitos intermedios
--      de dias (3, 14, 50, 200, 500, 1000) ademas de los 4 originales
--      (7, 30, 100, 365).
--   3. Nueva tabla hour_milestones: hitos por horas totales de musica
--      escuchada (1h, 10h, 50h, 100h, 500h, 1000h, 5000h).
--   4. Trigger check_streak_milestones() actualizado para incluir los
--      nuevos hitos intermedios.
--   5. Trigger nuevo check_hour_milestones() disparado tras INSERT en
--      play_history, calcula horas totales del user y inserta milestones
--      cruzados.
--
-- Idempotente, sin breaking changes.

-- ──────────────────────────────────────────────────────────────────────
-- 1. user_streaks: columna para sincronizar el daily toast cross-device
-- ──────────────────────────────────────────────────────────────────────

alter table public.user_streaks
  add column if not exists last_daily_celebrated_date date;

comment on column public.user_streaks.last_daily_celebrated_date is
  'Fecha (hora local del user) en que la app mostro por ultima vez el daily streak toast. Si != current_date, mostrar de nuevo. Sincronizado cross-device.';

-- ──────────────────────────────────────────────────────────────────────
-- 2. streak_milestones: ampliar CHECK con hitos intermedios
-- ──────────────────────────────────────────────────────────────────────

alter table public.streak_milestones
  drop constraint if exists streak_milestones_milestone_check;

alter table public.streak_milestones
  add constraint streak_milestones_milestone_check
  check (milestone in (3, 7, 14, 30, 50, 100, 200, 365, 500, 1000));

-- ──────────────────────────────────────────────────────────────────────
-- 3. Trigger check_streak_milestones actualizado con hitos intermedios
-- ──────────────────────────────────────────────────────────────────────

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

  foreach v_milestone in array array[3, 7, 14, 30, 50, 100, 200, 365, 500, 1000] loop
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

-- Backfill: usuarios con racha actual >= nuevos umbrales.
insert into public.streak_milestones (user_id, milestone, streak_value)
select us.user_id, m.val, us.current_streak
from public.user_streaks us
cross join (values (3), (14), (50), (200), (500), (1000)) as m(val)
where us.current_streak >= m.val
on conflict do nothing;

-- ──────────────────────────────────────────────────────────────────────
-- 4. hour_milestones: tabla append-only para hitos de horas escuchadas
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.hour_milestones (
  user_id      uuid not null references auth.users(id) on delete cascade,
  hours        int  not null check (hours in (1, 10, 50, 100, 500, 1000, 5000)),
  achieved_at  date not null default current_date,
  total_hours  numeric not null,
  primary key (user_id, hours)
);

alter table public.hour_milestones enable row level security;

drop policy if exists "hour_milestones: owner read" on public.hour_milestones;
create policy "hour_milestones: owner read"
  on public.hour_milestones for select
  using (auth.uid() = user_id);

comment on table public.hour_milestones is
  'Hitos desbloqueados por horas totales de musica escuchada. Append-only. Recalculado por trigger tras cada INSERT en play_history.';

-- ──────────────────────────────────────────────────────────────────────
-- 5. Trigger check_hour_milestones tras INSERT en play_history
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.check_hour_milestones()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total_seconds bigint;
  v_total_hours numeric;
  v_hour int;
begin
  -- Suma todas las duraciones del user en play_history.
  -- Conservador: solo plays con duration_seconds NOT NULL.
  select coalesce(sum(duration_seconds), 0)
    into v_total_seconds
    from public.play_history
   where user_id = new.user_id
     and duration_seconds is not null;

  v_total_hours := v_total_seconds / 3600.0;

  foreach v_hour in array array[1, 10, 50, 100, 500, 1000, 5000] loop
    if v_total_hours >= v_hour then
      insert into public.hour_milestones (user_id, hours, total_hours)
      values (new.user_id, v_hour, v_total_hours)
      on conflict do nothing;
    end if;
  end loop;

  return new;
exception when others then
  raise warning 'check_hour_milestones fallo para user_id=% : %', new.user_id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists play_history_check_hours on public.play_history;
create trigger play_history_check_hours
  after insert on public.play_history
  for each row execute function public.check_hour_milestones();

-- Backfill: calcula horas totales por user y inserta milestones cruzados.
insert into public.hour_milestones (user_id, hours, total_hours)
select
  ph.user_id,
  m.val,
  sum(ph.duration_seconds) / 3600.0 as total_hours
from public.play_history ph
cross join (values (1), (10), (50), (100), (500), (1000), (5000)) as m(val)
where ph.duration_seconds is not null
group by ph.user_id, m.val
having sum(ph.duration_seconds) / 3600.0 >= m.val
on conflict do nothing;

-- ──────────────────────────────────────────────────────────────────────
-- 6. Realtime para hour_milestones
-- ──────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'hour_milestones'
  ) then
    alter publication supabase_realtime add table public.hour_milestones;
  end if;
end$$;
