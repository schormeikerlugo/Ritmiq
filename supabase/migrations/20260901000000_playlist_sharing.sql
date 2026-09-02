-- Ritmiq — Compartido dinámico de playlists (visibilidad + jalado + notificaciones)
--
-- Añade:
--   1. `playlists.visibility` (private|friends|public) para que el dueño exponga
--      sus playlists en su perfil.
--   2. `playlists.source_playlist_id` / `source_owner_id`: cuando alguien "jala"
--      una playlist, se materializa una COPIA propia que recuerda su origen para
--      poder re-sincronizar (traer los cambios del original) más tarde.
--   3. RLS de lectura cruzada: un amigo (o cualquiera si es 'public') puede LEER
--      las playlists visibles de otro usuario y sus `playlist_tracks`. La
--      metadata de los tracks NO se abre por RLS (se resuelve vía Edge Function
--      con service-role para no exponer toda la biblioteca del dueño).
--   4. Tabla `notifications`: bandeja unificada de eventos (empezando por
--      "alguien jaló tu playlist"), con estado leído + realtime.

-- ── 1. Visibilidad ────────────────────────────────────────────────────────
alter table public.playlists
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'friends', 'public'));

-- Índice parcial: solo playlists expuestas (la gran mayoría serán 'private').
create index if not exists idx_playlists_visibility
  on public.playlists(user_id, visibility)
  where visibility <> 'private';

-- ── 2. Origen de una copia jalada ─────────────────────────────────────────
alter table public.playlists
  add column if not exists source_playlist_id uuid;
alter table public.playlists
  add column if not exists source_owner_id uuid;

-- ── 3. RLS de lectura cruzada ─────────────────────────────────────────────
-- Nota: NO tocamos las políticas owner existentes (owner read/write). Solo
-- AÑADIMOS una política de lectura para terceros según visibilidad.

-- Helper: ¿son amigos mutuos aceptados `a` y `b`?
create or replace function public.are_mutual_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.mutual_friends mf
    where mf.user_id = a and mf.friend_id = b
  );
$$;

-- playlists: lectura para terceros si la playlist es 'public', o 'friends' y
-- el lector es amigo mutuo del dueño.
drop policy if exists "playlists: visible read" on public.playlists;
create policy "playlists: visible read"
  on public.playlists for select
  using (
    visibility = 'public'
    or (visibility = 'friends' and public.are_mutual_friends(auth.uid(), user_id))
  );

-- NOTA: NO abrimos RLS de lectura cruzada en `playlist_tracks`. La Edge
-- Function `get-profile-playlists` resuelve los tracks de playlists visibles
-- con service-role (sin exponer la biblioteca del dueño). Abrir esta RLS
-- causaba que el canal realtime SIN filtro de `playlist_tracks` recibiera
-- eventos de playlists AJENAS (públicas/de-amigos), creando playlists
-- fantasma en el store del que mira un perfil. Se mantiene deshabilitada.
drop policy if exists "playlist_tracks: visible read" on public.playlist_tracks;

-- ── 4. Tabla de notificaciones ────────────────────────────────────────────
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade, -- destinatario
  actor_id     uuid references auth.users(id) on delete set null,          -- quién lo provocó
  type         text not null,                                              -- 'playlist_pulled', ...
  -- Payload flexible por tipo. Para 'playlist_pulled':
  --   { playlistId, playlistName, coverUrl, trackCount }
  data         jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_notifications_user
  on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread
  on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;

-- El destinatario lee sus notificaciones.
drop policy if exists "notifications: owner read" on public.notifications;
create policy "notifications: owner read"
  on public.notifications for select
  using (auth.uid() = user_id);

-- El destinatario actualiza (marcar leído) sus notificaciones.
drop policy if exists "notifications: owner update" on public.notifications;
create policy "notifications: owner update"
  on public.notifications for update
  using (auth.uid() = user_id);

-- El destinatario puede borrar sus notificaciones.
drop policy if exists "notifications: owner delete" on public.notifications;
create policy "notifications: owner delete"
  on public.notifications for delete
  using (auth.uid() = user_id);

-- Nota: la INSERCIÓN la hace la Edge Function con service-role (bypass RLS),
-- así el actor no puede falsificar notificaciones directamente.

-- Realtime: el destinatario recibe la notificación al instante.
alter table public.notifications replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
