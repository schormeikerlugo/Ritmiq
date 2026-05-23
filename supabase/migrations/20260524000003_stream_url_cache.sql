-- Cache global de URLs de stream resueltas (Fase 1 del plan de cache).
--
-- Cualquier desktop Hoster que resuelve un ytId con yt-dlp y obtiene
-- una URL googlevideo valida, publica aqui via Edge Function. Cualquier
-- cliente autenticado puede leer.
--
-- Beneficio: si UN desktop ha resuelto "Bohemian Rhapsody" en los
-- ultimos 5-6h, todos los demas users (incluso sin desktop propio)
-- reproducen al instante sin yt-dlp ni Edge resolve-stream. Reduce
-- carga en YouTube y latencia ~30ms vs 1-3s del path actual.
--
-- TTL ~5h (URLs googlevideo expiran ~6h). Cron prune horario limpia.
--
-- Idempotente.

create table if not exists public.stream_url_cache (
  yt_id        text primary key,
  url          text not null,
  content_type text not null default 'audio/mp4',
  expires_at   timestamptz not null,
  source       text not null default 'desktop' check (source in ('desktop','edge','manual')),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_stream_url_cache_expires
  on public.stream_url_cache(expires_at);

alter table public.stream_url_cache enable row level security;

-- Cualquier user autenticado puede LEER del cache.
drop policy if exists "stream_url_cache: any auth read" on public.stream_url_cache;
create policy "stream_url_cache: any auth read"
  on public.stream_url_cache for select
  using (auth.role() = 'authenticated');

-- INSERT/UPDATE/DELETE solo via Edge Function con service_role.
-- No agregamos policies para clientes; quedan implicitamente denegadas.

-- ── Cron de limpieza horario ──────────────────────────────────────────
-- Borra URLs caducadas. Idempotente: si la job ya existe la salta.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'stream-url-cache-prune') then
      perform cron.schedule(
        'stream-url-cache-prune',
        '0 * * * *',
        $cmd$ delete from public.stream_url_cache where expires_at < now(); $cmd$
      );
    end if;
  end if;
end$$;

comment on table public.stream_url_cache is
  'Cache global de URLs googlevideo resueltas. RLS: cualquier auth lee, solo service_role escribe. Cron horario limpia caducadas.';
