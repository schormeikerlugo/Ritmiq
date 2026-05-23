-- Tabla denormalizada de racha por usuario.
--
-- Contexto: hasta ahora la racha se calculaba en el frontend desde los
-- ultimos 500 eventos de play_history (HISTORY_LIMIT). Esto tiene dos
-- problemas:
--   1. Rachas muy largas con muchas plays/dia podrian quedar truncadas
--      (500 events cubren <30 dias si escuchas 20+ tracks diarios).
--   2. Si el usuario reinstala la app, debe esperar al pull inicial para
--      ver su racha; no la ve en el primer render.
--
-- Esta tabla guarda current_streak + longest_streak (record historico)
-- + last_played_date, calculados por trigger AFTER INSERT en
-- play_history. El cliente lee 1 row al login y queda sincronizado por
-- Realtime para multidevice.
--
-- RLS: cada user solo lee su propia fila. Solo el trigger
-- (security definer) escribe; ningun cliente puede mutar.
--
-- Idempotente.

create table if not exists public.user_streaks (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  current_streak   int  not null default 0,
  longest_streak   int  not null default 0,
  longest_at       date,
  last_played_date date,
  updated_at       timestamptz not null default now()
);

alter table public.user_streaks enable row level security;

drop policy if exists "user_streaks: owner read" on public.user_streaks;
create policy "user_streaks: owner read"
  on public.user_streaks for select
  using (auth.uid() = user_id);

-- ── Trigger: refresca user_streaks tras cada nueva fila en play_history ─

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
  -- Timezone del profile, fallback a UTC.
  select coalesce(timezone, 'UTC') into v_tz
  from public.profiles where id = v_user_id;

  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;

  -- Reutilizar la funcion existente de streak-reminder (DRY).
  select streak_days, played_today
  into v_streak, v_played_today
  from public.compute_user_streak(v_user_id);

  -- Upsert con longest_streak/longest_at preservados.
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
  -- CRITICO: nunca propagar el error. Si el trigger falla por cualquier
  -- razon (bug en compute_user_streak, problema temporal de DB, etc.)
  -- el INSERT en play_history DEBE completarse de todos modos. Perder
  -- plays seria peor que tener un user_streaks desactualizado.
  raise warning 'refresh_user_streak fallo para user_id=% : %', v_user_id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists play_history_refresh_streak on public.play_history;
create trigger play_history_refresh_streak
  after insert on public.play_history
  for each row execute function public.refresh_user_streak();

-- ── Backfill: poblar con historico actual ─────────────────────────────

insert into public.user_streaks (user_id, current_streak, longest_streak, longest_at, last_played_date)
select
  sub.user_id,
  cus.streak_days,
  cus.streak_days,
  current_date,
  current_date
from (select distinct user_id from public.play_history) sub
cross join lateral public.compute_user_streak(sub.user_id) cus
on conflict (user_id) do nothing;

-- ── Realtime ──────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_streaks'
  ) then
    alter publication supabase_realtime add table public.user_streaks;
  end if;
end$$;

comment on table public.user_streaks is
  'Racha actual + record historico de cada usuario. Actualizada por trigger AFTER INSERT en play_history. RLS: solo el dueno puede leer.';
