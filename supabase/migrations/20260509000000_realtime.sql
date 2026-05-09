-- Ritmiq — habilitar Realtime en las tablas de dominio.
-- Necesario para que supabase-js reciba eventos de INSERT/UPDATE/DELETE.

-- REPLICA IDENTITY FULL hace que UPDATE y DELETE incluyan la fila completa
-- en el log de replicación; sin esto, los eventos no traerían datos útiles.
alter table public.tracks          replica identity full;
alter table public.playlists       replica identity full;
alter table public.playlist_tracks replica identity full;

-- Añadir las tablas a la publicación que Realtime escucha.
-- Idempotente: la publicación 'supabase_realtime' ya existe en cualquier
-- proyecto Supabase. Solo añadimos las tablas que aún no estén.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tracks'
  ) then
    alter publication supabase_realtime add table public.tracks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'playlists'
  ) then
    alter publication supabase_realtime add table public.playlists;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'playlist_tracks'
  ) then
    alter publication supabase_realtime add table public.playlist_tracks;
  end if;
end $$;
