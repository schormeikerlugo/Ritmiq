-- Jam queue colaborativa (Fase 8 / Bloque 3.4): cola de sugerencias.
--
-- Modelo: cualquier PARTICIPANTE de una jam puede sugerir canciones a una
-- cola compartida. Cada sugerencia queda identificada por quien la propuso
-- (suggested_by) para mostrar su avatar + nombre en la UI. El HOST decide
-- que suena (reproducir = marcar played_at + aplicar al player local, que
-- se propaga por el sync existente), el orden (position) y puede quitar
-- cualquier item. Un guest puede quitar SOLO sus propias sugerencias
-- mientras no se hayan reproducido (played_at is null).
--
-- Esto respeta el modelo "host controla": las sugerencias son propuestas,
-- no reproduccion automatica. Ver flujo [[Jam-Mode]].

create table if not exists public.jam_queue (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.jam_sessions(id) on delete cascade,
  suggested_by  uuid not null references auth.users(id) on delete cascade,
  track         jsonb not null,        -- { ytId, title, artist, coverUrl, durationSeconds }
  position      numeric not null default 0,  -- orden en la cola (el host reordena)
  played_at     timestamptz,           -- null = pendiente; set cuando el host la reproduce
  created_at    timestamptz not null default now()
);

create index if not exists jam_queue_session_idx on public.jam_queue (session_id);
create index if not exists jam_queue_order_idx on public.jam_queue (session_id, position);

-- Realtime: los clientes escuchan INSERT/UPDATE/DELETE en jam-queue:<sessionId>.
alter publication supabase_realtime add table public.jam_queue;

alter table public.jam_queue enable row level security;

-- SELECT: cualquiera en la sesion ve la cola (mismo criterio abierto que
-- jam_sessions/jam_participants — join por codigo sin friccion).
create policy jam_queue_read on public.jam_queue
  for select using (true);

-- INSERT: solo puedes sugerir como tu mismo Y debes ser participante de la
-- sesion (existe tu fila en jam_participants).
create policy jam_queue_insert_participant on public.jam_queue
  for insert with check (
    auth.uid() = suggested_by
    and exists (
      select 1 from public.jam_participants p
      where p.session_id = jam_queue.session_id
        and p.user_id = auth.uid()
    )
  );

-- UPDATE: solo el host de la sesion (reordenar / marcar played_at).
create policy jam_queue_update_host on public.jam_queue
  for update using (
    auth.uid() = (
      select host_id from public.jam_sessions s where s.id = jam_queue.session_id
    )
  );

-- DELETE: el host (cualquier item) o el autor si aun no se reprodujo.
create policy jam_queue_delete_host_or_owner on public.jam_queue
  for delete using (
    auth.uid() = (
      select host_id from public.jam_sessions s where s.id = jam_queue.session_id
    )
    or (auth.uid() = suggested_by and played_at is null)
  );

comment on table public.jam_queue is
  'Cola colaborativa de sugerencias de un Jam. Participantes insertan; el host reproduce/ordena/quita. played_at null = pendiente.';
