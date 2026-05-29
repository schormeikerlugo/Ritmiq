-- Jam mode (Fase 8): sesiones de escucha colaborativa.
--
-- Modelo simple host\u2192participants:
--   - El host crea una sesion. Se le asigna un codigo corto (6 chars,
--     human-friendly) que comparte con sus amigos.
--   - Los participantes se unen via el codigo. Su client_id en
--     jam_participants permite identificarlos en presence.
--   - El host envia comandos (play/pause/seek/next) actualizando
--     `jam_sessions` (currentTrack + position_seconds + is_playing).
--     Esos updates se propagan via Realtime Postgres CDC a los
--     participantes que escuchan el canal "jam:<sessionId>".
--   - Los participantes NO escriben en jam_sessions; solo el host
--     (validado via RLS).
--
-- TTL: las sesiones se borran tras 24h de inactividad (cron). Si el
-- host cierra la app abruptamente, los participantes ven la sesion
-- "stale" (sin actualizaciones); UI muestra mensaje.

-- 1. Sesiones.
create table if not exists public.jam_sessions (
  id                uuid primary key default gen_random_uuid(),
  host_id           uuid not null references auth.users(id) on delete cascade,
  code              text not null unique,           -- 6 chars uppercase
  current_track     jsonb,                          -- { ytId, title, artist, coverUrl, durationSeconds }
  position_seconds  numeric not null default 0,
  is_playing        boolean not null default false,
  queue             jsonb not null default '[]',    -- array de tracks pendientes
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_jam_sessions_host on public.jam_sessions(host_id);
create index if not exists idx_jam_sessions_code on public.jam_sessions(code);
create index if not exists idx_jam_sessions_updated on public.jam_sessions(updated_at);

-- 2. Participantes (tracking de quien esta en la sesion).
create table if not exists public.jam_participants (
  session_id    uuid not null references public.jam_sessions(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index if not exists idx_jam_participants_session on public.jam_participants(session_id);
create index if not exists idx_jam_participants_user on public.jam_participants(user_id);

-- 3. Habilitar Realtime para que los participantes reciban CDC.
alter publication supabase_realtime add table public.jam_sessions;
alter publication supabase_realtime add table public.jam_participants;

-- 4. RLS.
alter table public.jam_sessions enable row level security;
alter table public.jam_participants enable row level security;

-- Sesiones: cualquier authenticated puede LEER (para join via code).
drop policy if exists "jam_sessions_read" on public.jam_sessions;
create policy "jam_sessions_read"
  on public.jam_sessions for select
  to authenticated
  using (true);

-- INSERT: cualquier authenticated puede crear (se convierte en host).
drop policy if exists "jam_sessions_insert_self" on public.jam_sessions;
create policy "jam_sessions_insert_self"
  on public.jam_sessions for insert
  to authenticated
  with check (auth.uid() = host_id);

-- UPDATE: solo el host puede modificar (current_track, position, etc).
drop policy if exists "jam_sessions_update_host" on public.jam_sessions;
create policy "jam_sessions_update_host"
  on public.jam_sessions for update
  to authenticated
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

-- DELETE: solo el host (cerrar la sesion).
drop policy if exists "jam_sessions_delete_host" on public.jam_sessions;
create policy "jam_sessions_delete_host"
  on public.jam_sessions for delete
  to authenticated
  using (auth.uid() = host_id);

-- Participantes: LEER quien esta en la sesion.
drop policy if exists "jam_participants_read" on public.jam_participants;
create policy "jam_participants_read"
  on public.jam_participants for select
  to authenticated
  using (true);

-- INSERT: cada user inserta su propia fila (join).
drop policy if exists "jam_participants_insert_self" on public.jam_participants;
create policy "jam_participants_insert_self"
  on public.jam_participants for insert
  to authenticated
  with check (auth.uid() = user_id);

-- UPDATE: cada user actualiza su propio last_seen_at (heartbeat).
drop policy if exists "jam_participants_update_self" on public.jam_participants;
create policy "jam_participants_update_self"
  on public.jam_participants for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- DELETE: cada user puede borrar su propia fila (leave).
drop policy if exists "jam_participants_delete_self" on public.jam_participants;
create policy "jam_participants_delete_self"
  on public.jam_participants for delete
  to authenticated
  using (auth.uid() = user_id);

-- 5. Generador de codigo corto (6 chars uppercase, sin chars ambiguos).
--    Excluye 0/O y 1/I para que el codigo sea facil de leer en voz alta.
create or replace function public.generate_jam_code()
returns text
language plpgsql
as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_i int;
begin
  for v_i in 1..6 loop
    v_code := v_code || substr(v_chars, (random() * length(v_chars) + 1)::int, 1);
  end loop;
  return v_code;
end;
$$;

-- 6. Cron de cleanup: borrar sesiones con > 24h sin actividad.
create or replace function public.cron_cleanup_jam_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.jam_sessions
  where updated_at < now() - interval '24 hours';
  get diagnostics v_deleted = row_count;
  raise notice 'cron_cleanup_jam_sessions: deleted % sessions', v_deleted;
end;
$$;

-- Schedule a las 04:30 UTC (despues del prune de rec cache).
do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job
    where jobname = 'ritmiq-cleanup-jam-sessions'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

select cron.schedule(
  'ritmiq-cleanup-jam-sessions',
  '30 4 * * *',
  $$ select public.cron_cleanup_jam_sessions(); $$
);

revoke all on function public.cron_cleanup_jam_sessions() from public;

comment on table public.jam_sessions is
  'Sesiones de escucha colaborativa. Host envia comandos (current_track + position + is_playing); participantes escuchan via Realtime CDC. Cron limpia las > 24h sin updates.';
comment on table public.jam_participants is
  'Participantes activos en una jam session. Cada user inserta su fila al join, actualiza last_seen_at periodicamente, y la borra al leave.';
