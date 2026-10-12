-- Recuperacion de racha (2026-10-12):
--
-- Si el usuario pasa un dia LOCAL sin escuchar, la racha se rompe. Ahora
-- puede recuperarla manualmente con intentos mensuales:
--
--   - 5 intentos por mes calendario (dia 1, timezone del perfil). No se
--     acumulan: cada mes vuelve a haber 5.
--   - 1 intento por dia faltante (hueco de 3 dias = 3 intentos).
--   - Plazo: hasta 48 h despues de que termine el ultimo dia faltante
--     (si fallas el lunes, puedes recuperarlo hasta el miercoles inclusive).
--   - Manual: el cliente pide la oferta (get_streak_repair_offer) y el
--     usuario decide gastarla (repair_streak).
--
-- Cada dia recuperado queda en streak_repairs y compute_user_streak lo
-- cuenta como dia activo. Asi la racha recuperada sobrevive a los
-- recalculos del trigger en cada play (a diferencia de editar
-- user_streaks a mano).
--
-- Ademas sube el tope de seguridad de compute_user_streak de 365 a 3650
-- dias (las rachas de mas de un ano se quedaban congeladas en 365).
--
-- Idempotente.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Tabla de dias recuperados
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.streak_repairs (
  user_id       uuid not null references auth.users(id) on delete cascade,
  repaired_date date not null,
  used_at       timestamptz not null default now(),
  primary key (user_id, repaired_date)
);

alter table public.streak_repairs enable row level security;

drop policy if exists "streak_repairs: owner read" on public.streak_repairs;
create policy "streak_repairs: owner read"
  on public.streak_repairs for select
  using (auth.uid() = user_id);

-- Sin policies de escritura: solo repair_streak() (security definer) inserta.

comment on table public.streak_repairs is
  'Dias LOCALES sin escucha cubiertos con un intento de recuperacion de racha. compute_user_streak los cuenta como activos. Escribe solo repair_streak().';

-- ──────────────────────────────────────────────────────────────────────
-- 2. Helpers internos
-- ──────────────────────────────────────────────────────────────────────

create or replace function public._streak_user_tz(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select timezone from public.profiles where user_id = p_user_id), 'UTC');
$$;

-- Dia activo = hubo al menos un play ese dia LOCAL o fue recuperado.
create or replace function public._streak_day_active(p_user_id uuid, p_day date, p_tz text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
           select 1 from public.play_history
           where user_id = p_user_id
             and (played_at at time zone p_tz)::date = p_day
         )
      or exists(
           select 1 from public.streak_repairs
           where user_id = p_user_id
             and repaired_date = p_day
         );
$$;

revoke all on function public._streak_user_tz(uuid) from public, anon, authenticated;
revoke all on function public._streak_day_active(uuid, date, text) from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- 3. compute_user_streak: cuenta dias recuperados + tope 3650
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.compute_user_streak(p_user_id uuid)
returns table (streak_days int, played_today boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz           text := public._streak_user_tz(p_user_id);
  v_today        date := (now() at time zone v_tz)::date;
  v_played_today boolean;
  v_streak       int := 0;
  v_check_date   date;
begin
  -- played_today sigue mirando SOLO play_history: lo usa streak-reminder
  -- para decidir si avisar, y un dia recuperado no es "ya escuche hoy".
  select exists(
    select 1 from public.play_history
    where user_id = p_user_id
      and (played_at at time zone v_tz)::date = v_today
  ) into v_played_today;

  v_check_date := case when v_played_today then v_today else v_today - 1 end;

  while public._streak_day_active(p_user_id, v_check_date, v_tz) loop
    v_streak := v_streak + 1;
    v_check_date := v_check_date - 1;
    -- Safety: no contar mas de 10 anos hacia atras.
    exit when v_streak >= 3650;
  end loop;

  return query select v_streak, v_played_today;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────
-- 4. Oferta de recuperacion (calculo puro, no escribe)
-- ──────────────────────────────────────────────────────────────────────

create or replace function public._streak_repair_offer(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c_monthly_limit constant int := 5;
  v_tz          text := public._streak_user_tz(p_user_id);
  v_today       date := (now() at time zone v_tz)::date;
  v_used        int;
  v_remaining   int;
  v_run_start   date;
  v_run_end     date;
  v_run_len     int := 0;
  v_last_missed date;
  v_gap         int := 0;
  v_prev_end    date;
  v_prev_len    int := 0;
  v_d           date;
  v_base        jsonb;
begin
  -- Intentos gastados este mes calendario (en la tz del usuario).
  select count(*) into v_used
  from public.streak_repairs
  where user_id = p_user_id
    and date_trunc('month', used_at at time zone v_tz) = date_trunc('month', now() at time zone v_tz);
  v_remaining := greatest(c_monthly_limit - v_used, 0);

  v_base := jsonb_build_object(
    'available', false,
    'monthly_limit', c_monthly_limit,
    'remaining', v_remaining
  );

  -- Racha en curso: termina hoy (si hoy esta activo) o ayer.
  if public._streak_day_active(p_user_id, v_today, v_tz) then
    v_run_end := v_today;
  elsif public._streak_day_active(p_user_id, v_today - 1, v_tz) then
    v_run_end := v_today - 1;
  end if;

  if v_run_end is not null then
    v_run_start := v_run_end;
    while public._streak_day_active(p_user_id, v_run_start - 1, v_tz) loop
      v_run_start := v_run_start - 1;
      exit when v_run_end - v_run_start >= 3650;
    end loop;
    v_run_len := v_run_end - v_run_start + 1;
    v_last_missed := v_run_start - 1;
  else
    v_last_missed := v_today - 1;
  end if;

  -- Plazo de 48 h tras terminar el ultimo dia faltante.
  if v_today - v_last_missed > 2 then
    return v_base || jsonb_build_object('reason', 'none');
  end if;

  -- Medir el hueco hacia atras hasta la racha anterior.
  v_d := v_last_missed;
  while not public._streak_day_active(p_user_id, v_d, v_tz) loop
    v_gap := v_gap + 1;
    v_d := v_d - 1;
    if v_gap > c_monthly_limit then
      return v_base || jsonb_build_object('reason', 'gap_too_long');
    end if;
  end loop;
  v_prev_end := v_d;

  -- Largo de la racha anterior al hueco (la que se recupera).
  while public._streak_day_active(p_user_id, v_d, v_tz) loop
    v_prev_len := v_prev_len + 1;
    v_d := v_d - 1;
    exit when v_prev_len >= 3650;
  end loop;

  return v_base || jsonb_build_object(
    'available', v_remaining >= v_gap,
    'reason', case when v_remaining >= v_gap then 'ok' else 'not_enough' end,
    'cost', v_gap,
    'missed_days', (
      select jsonb_agg(d::date order by d)
      from generate_series(v_prev_end + 1, v_last_missed, interval '1 day') d
    ),
    'previous_streak', v_prev_len,
    'restored_streak', v_prev_len + v_gap + v_run_len,
    'deadline', v_last_missed + 2
  );
end;
$$;

revoke all on function public._streak_repair_offer(uuid) from public, anon, authenticated;

create or replace function public.get_streak_repair_offer()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public._streak_repair_offer(auth.uid());
$$;

-- ──────────────────────────────────────────────────────────────────────
-- 5. Gastar intentos y recalcular user_streaks
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.repair_streak()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id  uuid := auth.uid();
  v_tz       text;
  v_offer    jsonb;
  v_streak   int;
  v_last_day date;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Serializa dobles taps / multiples dispositivos del mismo usuario.
  perform pg_advisory_xact_lock(hashtext('repair_streak:' || v_user_id::text));

  v_offer := public._streak_repair_offer(v_user_id);
  if not coalesce((v_offer->>'available')::boolean, false) then
    raise exception 'streak_repair_unavailable: %', coalesce(v_offer->>'reason', 'none');
  end if;

  insert into public.streak_repairs (user_id, repaired_date)
  select v_user_id, (d #>> '{}')::date
  from jsonb_array_elements(v_offer->'missed_days') d
  on conflict do nothing;

  -- Recalcular la racha. last_played_date = ultimo dia activo (play o
  -- recuperado) para que el cliente no siga viendo la racha como rota.
  v_tz := public._streak_user_tz(v_user_id);
  select streak_days into v_streak from public.compute_user_streak(v_user_id);
  select greatest(
    (select max((played_at at time zone v_tz)::date) from public.play_history where user_id = v_user_id),
    (select max(repaired_date) from public.streak_repairs where user_id = v_user_id)
  ) into v_last_day;

  -- El trigger user_streaks_check_milestones otorga los trofeos que se
  -- crucen al recuperar.
  insert into public.user_streaks
    (user_id, current_streak, longest_streak, longest_at, last_played_date, updated_at)
  values
    (v_user_id, v_streak, v_streak, v_last_day, v_last_day, now())
  on conflict (user_id) do update set
    current_streak   = excluded.current_streak,
    longest_streak   = greatest(public.user_streaks.longest_streak, excluded.current_streak),
    longest_at       = case
                         when excluded.current_streak > public.user_streaks.longest_streak
                         then excluded.last_played_date
                         else public.user_streaks.longest_at
                       end,
    last_played_date = greatest(public.user_streaks.last_played_date, excluded.last_played_date),
    updated_at       = now();

  return jsonb_build_object('current_streak', v_streak)
      || jsonb_build_object('offer', public._streak_repair_offer(v_user_id));
end;
$$;

revoke all on function public.get_streak_repair_offer() from public, anon;
revoke all on function public.repair_streak() from public, anon;
grant execute on function public.get_streak_repair_offer() to authenticated;
grant execute on function public.repair_streak() to authenticated;
