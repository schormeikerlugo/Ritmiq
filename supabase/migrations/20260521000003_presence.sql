-- Ritmiq — Sistema social: presencia "Escuchando ahora"
--
-- Una fila por usuario activo. El cliente actualiza esta fila cada
-- ~30s mientras reproduce. Si expires_at < now() el usuario se
-- considera offline/inactivo (TTL de 2 minutos).
-- Solo visible para amigos mutuos (via RLS + mutual_friends view).

create table public.presence (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  yt_id            text,
  title            text,
  artist           text,
  cover_url        text,
  duration_seconds int,
  position_seconds int,           -- posicion actual en segundos (aprox)
  started_at       timestamptz not null default now(),
  expires_at       timestamptz not null default (now() + interval '2 minutes')
);

create index idx_presence_expires on public.presence(expires_at);

alter table public.presence enable row level security;

-- Solo los amigos mutuos ven tu presencia, Y solo si show_activity = true.
-- La subquery a mutual_friends + profiles garantiza privacidad.
create policy "presence: friends read"
  on public.presence for select
  using (
    -- el usuario ve su propia fila
    auth.uid() = user_id
    or
    -- o es amigo mutuo Y el usuario tiene show_activity = true
    (
      exists (
        select 1 from public.mutual_friends mf
        where mf.user_id = auth.uid()
          and mf.friend_id = presence.user_id
      )
      and exists (
        select 1 from public.profiles p
        where p.user_id = presence.user_id
          and p.show_activity = true
      )
    )
  );

-- Solo el propio usuario puede insertar/actualizar/eliminar su presencia.
create policy "presence: own write"
  on public.presence for insert
  with check (auth.uid() = user_id);

create policy "presence: own update"
  on public.presence for update
  using (auth.uid() = user_id);

create policy "presence: own delete"
  on public.presence for delete
  using (auth.uid() = user_id);

-- Realtime: los amigos reciben actualizaciones de presencia en tiempo real.
alter table public.presence replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'presence'
  ) then
    alter publication supabase_realtime add table public.presence;
  end if;
end;
$$;

-- Cron: limpia filas expiradas cada 5 minutos para no acumular basura.
-- Requiere pg_cron (ya habilitado en migracion de rec_cache).
-- Envuelto en DO block para hacer el unschedule condicional.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'presence-cleanup') then
    perform cron.unschedule('presence-cleanup');
  end if;
end;
$$;

select cron.schedule(
  'presence-cleanup',
  '*/5 * * * *',
  $$ delete from public.presence where expires_at < now() $$
);
