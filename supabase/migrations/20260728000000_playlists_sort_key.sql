-- Ritmiq — orden de la lista de playlists (`sort_key`).
--
-- La lista de playlists ahora es ordenable: el usuario la reordena con drag
-- Y la playlist de la que reproduce sube al tope ("mover-al-tope"). Un único
-- orden gobernado por `sort_key` (mayor = más arriba), que actualizan tanto el
-- drag manual como el uso.
--
-- RLS existente (owner read/write por user_id) sigue aplicando sin cambios.

alter table public.playlists
  add column if not exists sort_key bigint not null default 0;

-- Índice para ordenar rápido por usuario.
create index if not exists idx_playlists_user_sort
  on public.playlists(user_id, sort_key desc);
