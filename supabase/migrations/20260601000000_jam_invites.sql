-- Ritmiq — Invitaciones de Jam via Amigos (Bloque 3.6)
--
-- Flujo: el anfitrion (que ya creo una jam_sessions y es host) invita a un
-- amigo. Se inserta una fila aqui con el codigo de la jam. El receptor la ve
-- en su pestana Solicitudes (+ toast realtime + push). Si acepta, hace
-- joinSession(code); si rechaza, le llega un push al host.
--
-- Modelo calcado de shared_items (sender/receiver + estado), con la jam
-- referenciada por session_id + code (snapshot, para que el receptor pueda
-- unirse aunque algo cambie).

create table public.jam_invites (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references auth.users(id) on delete cascade,
  receiver_id  uuid not null references auth.users(id) on delete cascade,
  session_id   uuid not null references public.jam_sessions(id) on delete cascade,
  code         text not null,                 -- snapshot del codigo de la jam
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  responded_at timestamptz,
  created_at   timestamptz not null default now(),

  constraint jam_invites_no_self check (sender_id <> receiver_id)
);

create index idx_jam_invites_receiver on public.jam_invites(receiver_id, created_at desc);
create index idx_jam_invites_sender   on public.jam_invites(sender_id, created_at desc);
create index idx_jam_invites_pending  on public.jam_invites(receiver_id) where status = 'pending';

alter table public.jam_invites enable row level security;

-- El receptor ve sus invitaciones.
create policy "jam_invites: receiver read"
  on public.jam_invites for select
  using (auth.uid() = receiver_id);

-- El emisor ve las que ha enviado (para saber si fueron aceptadas/rechazadas).
create policy "jam_invites: sender read"
  on public.jam_invites for select
  using (auth.uid() = sender_id);

-- Solo el emisor crea invitaciones, y solo a amigos (amistad aceptada).
-- La validacion fuerte (amistad mutua) la hace ademas la edge function;
-- aqui exigimos al menos que exista una friendship accepted entre ambos.
create policy "jam_invites: sender insert"
  on public.jam_invites for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester = auth.uid() and f.addressee = receiver_id)
          or (f.addressee = auth.uid() and f.requester = receiver_id)
        )
    )
  );

-- El receptor actualiza el estado (accept/reject); el emisor puede cancelar.
create policy "jam_invites: receiver update"
  on public.jam_invites for update
  using (auth.uid() = receiver_id);
create policy "jam_invites: sender update"
  on public.jam_invites for update
  using (auth.uid() = sender_id);

-- Cualquiera de los dos puede borrar la fila.
create policy "jam_invites: participant delete"
  on public.jam_invites for delete
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- Realtime: el receptor recibe la invitacion al instante; el emisor recibe
-- el cambio de status (accepted/rejected).
alter table public.jam_invites replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'jam_invites'
  ) then
    alter publication supabase_realtime add table public.jam_invites;
  end if;
end;
$$;

comment on table public.jam_invites is
  'Invitaciones a un Jam enviadas a amigos. sender = host que invita, receiver = amigo invitado. code = snapshot del codigo de la jam. status pending/accepted/rejected/cancelled.';
