-- Jam: expulsar participantes (2026-11-04).
--
-- Para la TV como altavoz (cualquiera con el QR/código se une), el host
-- necesita poder sacar a alguien. Expulsar = borrar su fila de
-- jam_participants + vetarlo en esa sesión (jam_bans) para que no vuelva a
-- entrar con el mismo código. "Cambiar código" (UPDATE jam_sessions.code, ya
-- permitido al host) limpia los vetos: con un código nuevo, quien lo reciba
-- puede entrar.
--
-- Idempotente.

create table if not exists public.jam_bans (
  session_id uuid not null references public.jam_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

alter table public.jam_bans enable row level security;

drop policy if exists "jam_bans: host all" on public.jam_bans;
create policy "jam_bans: host all"
  on public.jam_bans for all
  to authenticated
  using (exists (select 1 from public.jam_sessions s where s.id = session_id and s.host_id = auth.uid()))
  with check (exists (select 1 from public.jam_sessions s where s.id = session_id and s.host_id = auth.uid()));

drop policy if exists "jam_bans: self read" on public.jam_bans;
create policy "jam_bans: self read"
  on public.jam_bans for select
  to authenticated
  using (auth.uid() = user_id);

-- El host puede borrar cualquier participante de su sesión (expulsar).
drop policy if exists "jam_participants_delete_host" on public.jam_participants;
create policy "jam_participants_delete_host"
  on public.jam_participants for delete
  to authenticated
  using (exists (select 1 from public.jam_sessions s where s.id = session_id and s.host_id = auth.uid()));

-- Unirse: solo uno mismo y si no está vetado en esa sesión.
drop policy if exists "jam_participants_insert_self" on public.jam_participants;
create policy "jam_participants_insert_self"
  on public.jam_participants for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and not exists (select 1 from public.jam_bans b where b.session_id = jam_participants.session_id and b.user_id = auth.uid())
  );

-- Cambiar el código limpia los vetos de esa sesión.
create or replace function public.jam_clear_bans_on_code_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.code is distinct from old.code then
    delete from public.jam_bans where session_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists jam_sessions_code_change on public.jam_sessions;
create trigger jam_sessions_code_change
  after update of code on public.jam_sessions
  for each row execute function public.jam_clear_bans_on_code_change();

comment on table public.jam_bans is
  'Participantes expulsados de una jam (no pueden re-unirse con el mismo código). Se limpian al cambiar el código.';
