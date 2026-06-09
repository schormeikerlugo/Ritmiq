-- Tipo de Jam (Bloque 3.8): sincronizado vs altavoz.
--
--   'sync'    → todos los dispositivos reproducen el mismo audio en sync
--               (modelo actual, arranque coordinado).
--   'speaker' → SOLO el host reproduce audio (la bocina); los demas son
--               control remoto compartido (ven qué suena, sugieren, y
--               cualquiera puede play/pausa/saltar via broadcast).
--
-- default 'sync' → las jams existentes y el flujo actual no cambian.

alter table public.jam_sessions
  add column if not exists kind text not null default 'sync'
  check (kind in ('sync', 'speaker'));

comment on column public.jam_sessions.kind is
  'Tipo de jam: sync (todos reproducen en sync) o speaker (solo el host reproduce; los demas controlan).';
