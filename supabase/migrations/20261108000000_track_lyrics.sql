-- Letras sincronizadas POR VÍDEO de YouTube (2026-11-08).
--
-- LRCLIB (función `lyrics`) da la letra de una versión de la canción; sus
-- tiempos pueden no cuadrar con el vídeo que suena (intro del videoclip,
-- otra versión) o no existir. El servidor 24/7 obtiene aquí una letra
-- sincronizada con EL AUDIO DE ESE yt_id:
--   source 'youtube'  subtítulos subidos al propio vídeo,
--   source 'offset'   letra de LRCLIB desplazada para cuadrar (Whisper),
--   source 'whisper'  texto sin tiempos alineado con Whisper (RX 570).
-- status 'none' = se intentó y no hubo forma (no repetir).
--
-- Escritura: solo cuentas de servidor (is_art_writer()). Lectura: autenticados.
-- Idempotente.

create table if not exists public.track_lyrics (
  yt_id       text primary key,
  status      text not null check (status in ('found', 'none')),
  source      text,
  synced      text,
  offset_ms   integer,
  confidence  real,
  updated_at  timestamptz not null default now()
);

alter table public.track_lyrics enable row level security;

drop policy if exists "track_lyrics: read" on public.track_lyrics;
create policy "track_lyrics: read"
  on public.track_lyrics for select
  to authenticated
  using (true);

drop policy if exists "track_lyrics: server insert" on public.track_lyrics;
create policy "track_lyrics: server insert"
  on public.track_lyrics for insert
  to authenticated
  with check (public.is_art_writer());

drop policy if exists "track_lyrics: server update" on public.track_lyrics;
create policy "track_lyrics: server update"
  on public.track_lyrics for update
  to authenticated
  using (public.is_art_writer())
  with check (public.is_art_writer());

comment on table public.track_lyrics is
  'Letra sincronizada con el audio de cada yt_id (subtítulos de YouTube, desfase o alineación Whisper). status none = sin resultado.';
