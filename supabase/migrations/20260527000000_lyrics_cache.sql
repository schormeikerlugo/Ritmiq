-- Cache global de letras (lyrics) por hash de identidad de track.
--
-- La edge function `lyrics` resuelve la letra de un track via lrclib.net
-- (API publica gratuita) y la persiste aqui. Cualquier user autenticado
-- puede leer el cache; solo la service_role escribe.
--
-- Identidad del track: hash sha256 de "artist::title::durationSec"
-- normalizado a lowercase trim. Permite que el mismo cover sincronice
-- aun si los metadata varian ligeramente entre fuentes.
--
-- TTL: 30 dias. Cron mensual puede prunear filas con refreshed_at
-- > 90 dias (no implementado todavia, ver TODO al pie).
--
-- Estructura del payload:
--   {
--     "found": boolean,
--     "synced": "[00:00.00]Line 1\\n[00:03.20]Line 2\\n..." | null,
--     "plain":  "Line 1\\nLine 2\\n..." | null,
--     "instrumental": boolean,
--     "source": "lrclib"
--   }
--
-- found=false se cachea tambien para no martillar lrclib en cada play
-- de un track sin letra. Se refresca tras 7 dias en ese caso.
--
-- Idempotente.

create table if not exists public.lyrics_cache (
  cache_key    text primary key,
  artist       text not null,
  title        text not null,
  duration_sec int,
  payload      jsonb not null,
  refreshed_at timestamptz not null default now()
);

create index if not exists idx_lyrics_cache_refreshed
  on public.lyrics_cache(refreshed_at desc);

alter table public.lyrics_cache enable row level security;

-- Cualquier user autenticado puede LEER del cache.
drop policy if exists "lyrics_cache_read" on public.lyrics_cache;
create policy "lyrics_cache_read"
  on public.lyrics_cache for select
  to authenticated
  using (true);

-- Nadie puede escribir directamente \u2014 solo service_role via edge function.
-- No creamos policy de INSERT/UPDATE/DELETE; service_role bypasea RLS.

comment on table public.lyrics_cache is
  'Cache global de letras (lrclib.net). TTL 30 dias (found) / 7 dias (not found). Service role escribe via edge function lyrics.';
