-- Recordatorios de racha 2x/dia para evitar que el usuario pierda
-- su streak de dias consecutivos escuchando musica.
--
-- Flujo:
--   1. Cron pg_cron dispara la Edge Function streak-reminder dos veces
--      al dia (12:00 y 21:00 UTC \u2014 ajustable segun zona horaria del
--      proyecto).
--   2. La funcion lista usuarios con racha >= 1 que NO han escuchado
--      hoy todavia.
--   3. Para cada uno: envia push contextual y registra en
--      streak_reminder_log para no duplicar el mismo slot.
--   4. El slot 'noon' (mediodia) es suave: 'No pierdas tu racha de X
--      dias'. El slot 'evening' (noche) es mas urgente: 'Quedan pocas
--      horas para mantener tu racha de X dias'.

-- Log para deduplicar envios. Un usuario solo recibe 1 reminder por
-- slot (noon, evening) por dia. Si la funcion se ejecuta dos veces
-- el mismo dia (re-run manual, fallo + retry), el INSERT con unique
-- constraint evita el segundo push.

create table if not exists streak_reminder_log (
  id          uuid          primary key default gen_random_uuid(),
  user_id     uuid          not null references auth.users (id) on delete cascade,
  slot        text          not null check (slot in ('noon', 'evening')),
  sent_date   date          not null,
  streak_days int           not null,
  created_at  timestamptz   not null default now(),
  -- 1 reminder por (user, slot, date) maximo. La Edge Function intenta
  -- INSERT y skipea si ya existe (ON CONFLICT DO NOTHING).
  unique (user_id, slot, sent_date)
);

create index if not exists streak_reminder_log_user_idx
  on streak_reminder_log (user_id, sent_date desc);

-- RLS: solo service role. Usuarios no necesitan ver su propio log
-- (la info esta en play_history que si exponemos).
alter table streak_reminder_log enable row level security;

-- ── Helper SQL: calcular racha de un usuario ──────────────────────
--
-- Replica la logica del frontend (selectStatsForPeriod en
-- packages/ui/src/stores/history.js): cuenta dias consecutivos
-- hacia atras desde hoy donde haya al menos 1 play.
--
-- Se llama desde la Edge Function en un solo query para evitar N
-- round-trips. Devuelve:
--   streak_days  \u2014 dias consecutivos activos terminando hoy o ayer.
--   played_today \u2014 boolean: si ya escucho hoy, no necesita reminder.
--
-- Logica:
--   - Si played_today = true \u2192 streak ya esta safe, skip reminder.
--   - Si played_today = false Y streak >= 1 \u2192 esta en peligro, enviar
--     reminder. La 'racha' incluye los dias previos consecutivos hasta
--     ayer (sin contar hoy todavia).

create or replace function compute_user_streak(p_user_id uuid)
returns table (streak_days int, played_today boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today          date := current_date;
  v_played_today   boolean;
  v_streak         int := 0;
  v_check_date     date;
  v_has_play       boolean;
begin
  -- 1. \u00bfYa escucho hoy?
  select exists(
    select 1 from play_history
    where user_id = p_user_id
      and played_at >= v_today::timestamptz
      and played_at <  (v_today + 1)::timestamptz
  ) into v_played_today;

  -- 2. Contar racha: empezar desde ayer (si no escucho hoy) o desde
  --    hoy (si si escucho) e ir hacia atras hasta el primer dia sin
  --    play.
  v_check_date := case when v_played_today then v_today else v_today - 1 end;

  loop
    select exists(
      select 1 from play_history
      where user_id = p_user_id
        and played_at >= v_check_date::timestamptz
        and played_at <  (v_check_date + 1)::timestamptz
    ) into v_has_play;

    exit when not v_has_play;
    v_streak := v_streak + 1;
    v_check_date := v_check_date - 1;
    -- Safety: no contar mas de 365 dias hacia atras (evita scan
    -- infinito si hay algun bug raro en los datos).
    exit when v_streak >= 365;
  end loop;

  return query select v_streak, v_played_today;
end;
$$;

comment on function compute_user_streak(uuid) is
  'Calcula racha de dias consecutivos escuchando musica + flag si ya escucho hoy. Usado por Edge Function streak-reminder.';
