-- Ritmiq — Sistema social: amistades mutuas
--
-- Modelo: solicitud bidireccional (A pide, B acepta).
-- Una vez aceptada, AMBOS son amigos mutuos — la relacion es simetrica
-- aunque se almacena como una sola fila (requester → addressee).
-- La vista `mutual_friends` simetriza la consulta.

create table public.friendships (
  id          uuid primary key default gen_random_uuid(),
  requester   uuid not null references auth.users(id) on delete cascade,
  addressee   uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'rejected', 'blocked')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- una sola relacion por par, independientemente de quien la pidio
  constraint friendships_unique_pair unique (requester, addressee),
  -- no puedes ser amigo de ti mismo
  constraint friendships_no_self check (requester <> addressee)
);

create index idx_friendships_requester on public.friendships(requester, status);
create index idx_friendships_addressee on public.friendships(addressee, status);
create index idx_friendships_pending   on public.friendships(addressee) where status = 'pending';

alter table public.friendships enable row level security;

-- Solo ves filas donde eres requester o addressee.
create policy "friendships: read own"
  on public.friendships for select
  using (auth.uid() = requester or auth.uid() = addressee);

-- Solo puedes crear solicitudes donde eres el requester.
create policy "friendships: insert as requester"
  on public.friendships for insert
  with check (auth.uid() = requester);

-- Solo el addressee puede aceptar/rechazar; solo el requester puede
-- cancelar una pendiente; cualquiera de los dos puede bloquear.
create policy "friendships: update as participant"
  on public.friendships for update
  using (auth.uid() = requester or auth.uid() = addressee);

-- Cualquiera de los dos puede eliminar la amistad.
create policy "friendships: delete as participant"
  on public.friendships for delete
  using (auth.uid() = requester or auth.uid() = addressee);

-- Trigger: updated_at
create or replace function public.handle_friendship_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger friendship_updated_at
  before update on public.friendships
  for each row execute function public.handle_friendship_updated_at();

-- ── Vista: amigos mutuos ─────────────────────────────────────────────
-- Simetriza la tabla de friendships para que una consulta simple del
-- tipo `select * from mutual_friends where user_id = $1` devuelva
-- TODOS los amigos sin importar quien inicio la solicitud.
create view public.mutual_friends as
  select requester as user_id, addressee as friend_id
    from public.friendships where status = 'accepted'
  union all
  select addressee as user_id, requester as friend_id
    from public.friendships where status = 'accepted';

-- Habilitar Realtime para solicitudes entrantes (notificacion en tiempo real).
alter table public.friendships replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'friendships'
  ) then
    alter publication supabase_realtime add table public.friendships;
  end if;
end;
$$;
