-- Habilita Realtime para `play_history` — multidevice sync de la racha.
--
-- Contexto: la racha de dias activos se calcula desde `events` en memoria
-- del cliente. Sin Realtime, cuando el user reproduce en device A (iPhone)
-- y abre la app en device B (iPad/Desktop), B tiene un snapshot viejo y
-- la racha aparece DISMINUIDA hasta que B llama explicitamente a load().
--
-- Con `play_history` en la publicacion supabase_realtime, cualquier INSERT
-- se entrega via postgres_changes a todos los devices del mismo user en
-- <1s, manteniendo events sincronizados y la racha siempre actualizada.
--
-- RLS estricto de la tabla garantiza privacy: cada user solo recibe sus
-- propios eventos (filter user_id=eq.<my_uid>).
--
-- Idempotente.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'play_history'
  ) then
    alter publication supabase_realtime add table public.play_history;
  end if;
end$$;

-- REPLICA IDENTITY DEFAULT (PK) basta para INSERT — no necesitamos
-- payload completo de UPDATE/DELETE; el cliente solo escucha INSERTs.
