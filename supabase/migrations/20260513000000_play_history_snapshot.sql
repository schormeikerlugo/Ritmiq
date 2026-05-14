-- Ritmiq — historial enriquecido para recomendaciones (Fase 1).
--
-- play_history pasa de ser un puntero a `tracks.id` a ser un evento
-- autocontenido con snapshot del track al momento de la reproducción.
-- Esto permite registrar también tracks efímeros (yt:<id>) que el usuario
-- escucha desde el buscador sin guardarlos a biblioteca, y conservar el
-- historial intacto aunque el track original se elimine después.
--
-- Cambios:
--   - yt_id: id de YouTube del track (cuando aplica).
--   - title / artist / cover_url / duration_seconds: snapshot.
--   - duration_played_seconds: cuántos segundos efectivamente escuchó.
--   - source: 'youtube' | 'local'.
--
-- track_id queda nullable y como FK opcional para mantener compatibilidad.

alter table public.play_history
  alter column track_id drop not null;

alter table public.play_history
  add column if not exists yt_id text,
  add column if not exists title text,
  add column if not exists artist text,
  add column if not exists cover_url text,
  add column if not exists duration_seconds int,
  add column if not exists duration_played_seconds int,
  add column if not exists source text;

create index if not exists idx_play_history_user_yt
  on public.play_history(user_id, yt_id, played_at desc)
  where yt_id is not null;
