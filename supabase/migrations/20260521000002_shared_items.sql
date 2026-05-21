-- Ritmiq — Sistema social: bandeja de shares
--
-- Almacena tracks y playlists compartidos entre amigos.
-- Los tracks se guardan como campos planos (yt_id + metadata).
-- Las playlists se guardan como snapshot JSON para que el receptor
-- pueda reproducirlas/guardarlas aunque el emisor borre la original.

create table public.shared_items (
  id                uuid primary key default gen_random_uuid(),
  sender_id         uuid not null references auth.users(id) on delete cascade,
  receiver_id       uuid not null references auth.users(id) on delete cascade,
  kind              text not null check (kind in ('track', 'playlist')),

  -- Campos para kind='track'
  yt_id             text,
  title             text,
  artist            text,
  cover_url         text,
  duration_seconds  int,

  -- Campos para kind='playlist'
  -- Snapshot: { name, tracks: [{ytId,title,artist,coverUrl,durationSeconds}] }
  playlist_name     text,
  playlist_snapshot jsonb,

  -- Estado del item desde el punto de vista del receptor
  read_at           timestamptz,   -- null = no leido (badge en UI)
  saved_at          timestamptz,   -- null = no guardado en biblioteca
  played_at         timestamptz,   -- null = nunca reproducido

  -- Mensaje opcional del emisor ("escucha esto!")
  message           text check (length(message) <= 280),

  created_at        timestamptz not null default now(),

  -- No duplicar el mismo share en menos de 1 hora
  -- (previene spam de la misma cancion al mismo amigo)
  constraint shared_items_no_self check (sender_id <> receiver_id)
);

create index idx_shared_items_receiver      on public.shared_items(receiver_id, created_at desc);
create index idx_shared_items_sender        on public.shared_items(sender_id, created_at desc);
create index idx_shared_items_unread        on public.shared_items(receiver_id) where read_at is null;

alter table public.shared_items enable row level security;

-- El receptor ve todo lo que le han compartido.
create policy "shared_items: receiver read"
  on public.shared_items for select
  using (auth.uid() = receiver_id);

-- El emisor ve lo que ha enviado (para confirmar envio).
create policy "shared_items: sender read"
  on public.shared_items for select
  using (auth.uid() = sender_id);

-- Solo el emisor puede crear shares.
create policy "shared_items: sender insert"
  on public.shared_items for insert
  with check (auth.uid() = sender_id);

-- Solo el receptor puede marcar como leido/guardado/reproducido.
create policy "shared_items: receiver update"
  on public.shared_items for update
  using (auth.uid() = receiver_id);

-- Cualquiera de los dos puede eliminar el item de la bandeja.
create policy "shared_items: participant delete"
  on public.shared_items for delete
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- Realtime: el receptor recibe la notificacion en tiempo real cuando
-- alguien le comparte algo.
alter table public.shared_items replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'shared_items'
  ) then
    alter publication supabase_realtime add table public.shared_items;
  end if;
end;
$$;
