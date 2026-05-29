-- Jam roles (Fase 8 / Bloque 3.2): rol explicito por participante.
--
-- Antes: el rol "host" se derivaba implicitamente comparando
-- jam_participants.user_id == jam_sessions.host_id. Funciona pero:
--   - La UI tenia que cruzar dos fuentes para mostrar el badge.
--   - No habia forma de "pasar el control" a otro participante sin
--     reasignar host_id (que ademas afecta RLS de UPDATE/DELETE).
--
-- Ahora: jam_participants.role ('host' | 'guest'). El control de
-- escritura sobre jam_sessions SIGUE protegido por host_id (RLS
-- existente), asi que `role` es principalmente para UI + futura
-- transferencia de control. La transferencia real de control
-- (cambiar quien emite comandos) sigue requiriendo cambiar host_id,
-- documentado abajo.

-- 1. Columna role con default 'guest'.
alter table public.jam_participants
  add column if not exists role text not null default 'guest'
  check (role in ('host', 'guest'));

-- 2. Backfill: marcar como 'host' a los participantes que son el host
--    de su sesion (para sesiones legacy que no tenian la columna).
update public.jam_participants p
set role = 'host'
from public.jam_sessions s
where p.session_id = s.id
  and p.user_id = s.host_id
  and p.role <> 'host';

-- 3. Funcion para transferir el control a otro participante.
--    Solo el host actual puede ejecutarla (validado por host_id).
--    Reasigna jam_sessions.host_id + actualiza ambos roles atomicamente.
create or replace function public.jam_transfer_host(
  p_session_id uuid,
  p_new_host_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_host uuid;
begin
  -- Validar que el caller es el host actual.
  select host_id into v_current_host
  from public.jam_sessions
  where id = p_session_id;

  if v_current_host is null then
    raise exception 'sesion no encontrada';
  end if;
  if v_current_host <> auth.uid() then
    raise exception 'solo el host puede transferir el control';
  end if;

  -- El nuevo host debe ser un participante existente.
  if not exists (
    select 1 from public.jam_participants
    where session_id = p_session_id and user_id = p_new_host_id
  ) then
    raise exception 'el nuevo host debe estar en la sesion';
  end if;

  -- Reasignar host_id (cambia quien puede UPDATE jam_sessions por RLS).
  update public.jam_sessions
  set host_id = p_new_host_id, updated_at = now()
  where id = p_session_id;

  -- Actualizar roles: nuevo host -> 'host', antiguo -> 'guest'.
  update public.jam_participants
  set role = 'host'
  where session_id = p_session_id and user_id = p_new_host_id;

  update public.jam_participants
  set role = 'guest'
  where session_id = p_session_id and user_id = v_current_host;
end;
$$;

-- Solo authenticated puede invocarla; la validacion de host esta dentro.
revoke all on function public.jam_transfer_host(uuid, uuid) from public;
grant execute on function public.jam_transfer_host(uuid, uuid) to authenticated;

comment on column public.jam_participants.role is
  'Rol del participante: host (controla la reproduccion) o guest (solo escucha). El control real lo protege jam_sessions.host_id via RLS; esta columna es para UI + jam_transfer_host.';
