-- Trofeos / hitos por dias de racha alcanzados.
--
-- Append-only: una fila por (user, milestone) cuando el user CRUZA un
-- umbral por primera vez. Si pierde la racha y vuelve a cruzarla, no
-- se inserta de nuevo (mantenemos el achieved_at original — "primera
-- vez que llegaste a 30 dias").
--
-- Disparado por trigger AFTER INSERT OR UPDATE en user_streaks: si
-- current_streak nueva >= milestone Y la anterior no lo estaba,
-- insertar.
--
-- Idempotente.

create table if not exists public.streak_milestones (
  user_id      uuid not null references auth.users(id) on delete cascade,
  milestone    int  not null check (milestone in (7, 30, 100, 365)),
  achieved_at  date not null default current_date,
  streak_value int  not null,
  primary key (user_id, milestone)
);

alter table public.streak_milestones enable row level security;

drop policy if exists "streak_milestones: owner read" on public.streak_milestones;
create policy "streak_milestones: owner read"
  on public.streak_milestones for select
  using (auth.uid() = user_id);

-- ── Trigger: insertar nuevos milestones al cruzar umbrales ────────────

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

  foreach v_milestone in array array[7, 30, 100, 365] loop
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

drop trigger if exists user_streaks_check_milestones on public.user_streaks;
create trigger user_streaks_check_milestones
  after insert or update on public.user_streaks
  for each row execute function public.check_streak_milestones();

-- ── Backfill: milestones para users con racha actual >= umbrales ──────

insert into public.streak_milestones (user_id, milestone, streak_value)
select us.user_id, m.val, us.current_streak
from public.user_streaks us
cross join (values (7), (30), (100), (365)) as m(val)
where us.current_streak >= m.val
on conflict do nothing;

-- ── Realtime ──────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'streak_milestones'
  ) then
    alter publication supabase_realtime add table public.streak_milestones;
  end if;
end$$;

comment on table public.streak_milestones is
  'Trofeos desbloqueados por racha. Append-only, una fila por (user, milestone). El frontend muestra toast con confetti al recibir INSERT via Realtime.';
