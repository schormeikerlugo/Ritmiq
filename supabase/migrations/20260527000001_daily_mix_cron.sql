-- Daily Mix maintenance via pg_cron.
--
-- Ejecuta dos tareas a las 04:00 UTC cada dia (madrugada en Europa,
-- nocturna en America):
--
--   1. PRUNE: borra entradas de `recommendation_cache` con
--      refreshed_at < now() - '24 hours'. El endpoint /recommendations
--      tiene TTL 12h hardcoded, asi que las entradas > 24h estan
--      definitivamente stale. Esto evita que la tabla crezca
--      indefinidamente.
--
--   2. ENRICH-TAGS: llama a la edge function `enrich-tags` con los top
--      artistas (mas plays en los ultimos 7 dias). pg_net hace POST
--      async; no esperamos respuesta (fire-and-forget desde Postgres).
--      Resultado: artist_tags se mantiene fresco antes del horario
--      matutino de los usuarios → auto-genre-mix carga instantaneo.
--
-- Requisitos:
--   - Extension pg_net (HTTP cliente desde Postgres).
--   - Extension pg_cron (ya disponible en Supabase).
--   - Secrets: app.settings.supabase_url, app.settings.service_role_key
--     (configurados via supabase secrets en runtime; se leen con
--     current_setting('app.settings.<name>', true)).
--
-- Diseño tolerante a fallos: cualquier error en el cron job se loguea
-- en cron.job_run_details pero NO bloquea la otra tarea ni los users.
-- Idempotente: re-ejecutar la migracion no duplica jobs (cron.unschedule
-- previo).

-- 1. Extensions.
create extension if not exists pg_net;
-- pg_cron ya esta instalado (verificado 2026-05-27).

-- 2. Function: prune entries viejas de recommendation_cache.
create or replace function public.cron_prune_recommendation_cache()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.recommendation_cache
  where refreshed_at < now() - interval '24 hours';
  get diagnostics v_deleted = row_count;
  raise notice 'cron_prune_recommendation_cache: deleted % rows', v_deleted;
end;
$$;

-- 3. Function: dispara enrich-tags para los top artistas activos del
-- ultimo periodo. La invocacion es fire-and-forget via pg_net.
--
-- Las credenciales (URL + service_role_key) se leen desde supabase_vault
-- por nombre. Si los secrets no existen, el job loggea y sale sin error.
-- Crear con:
--   select vault.create_secret('<value>', '<name>', '<description>');
-- Nombres usados aqui:
--   ritmiq_supabase_url        → 'https://<ref>.supabase.co'
--   ritmiq_service_role_key    → service_role JWT del proyecto
create or replace function public.cron_refresh_artist_tags()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_url        text;
  v_token      text;
  v_artists    text[];
  v_body       jsonb;
  v_request_id bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'ritmiq_supabase_url' limit 1;
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'ritmiq_service_role_key' limit 1;

  if v_url is null or v_token is null then
    raise notice 'cron_refresh_artist_tags: secrets ritmiq_supabase_url o ritmiq_service_role_key no encontrados, saltando';
    return;
  end if;

  -- Top 30 artistas con mas plays en los ultimos 7 dias (global, todos
  -- los usuarios). 30 cubre los mas activos sin saturar Last.fm
  -- (rate limit 5 req/s × 6 segundos = 30 calls).
  select array_agg(artist order by plays desc)
  into v_artists
  from (
    select artist, count(*) as plays
    from public.play_history
    where artist is not null
      and trim(artist) <> ''
      and played_at >= now() - interval '7 days'
    group by artist
    order by plays desc
    limit 30
  ) t;

  if v_artists is null or array_length(v_artists, 1) = 0 then
    raise notice 'cron_refresh_artist_tags: sin artistas activos en los ultimos 7 dias';
    return;
  end if;

  v_body := jsonb_build_object('artists', to_jsonb(v_artists));

  -- POST async via pg_net. El response queda en net._http_response;
  -- no lo esperamos.
  select net.http_post(
    url := v_url || '/functions/v1/enrich-tags',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || v_token,
      'apikey', v_token
    ),
    body := v_body,
    timeout_milliseconds := 30000
  ) into v_request_id;

  raise notice 'cron_refresh_artist_tags: enrich-tags POST dispatched id=% artistas=%', v_request_id, array_length(v_artists, 1);
end;
$$;

-- 4. Schedule: 04:00 UTC daily.
-- Unschedule previo (idempotente) por si la migracion se aplica dos veces.
do $$
declare
  v_job_id bigint;
begin
  -- Para cada job nombrado en esta migracion, des-programar si existe.
  for v_job_id in
    select jobid from cron.job
    where jobname in ('ritmiq-prune-rec-cache', 'ritmiq-refresh-artist-tags')
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;

select cron.schedule(
  'ritmiq-prune-rec-cache',
  '0 4 * * *',
  $$ select public.cron_prune_recommendation_cache(); $$
);

select cron.schedule(
  'ritmiq-refresh-artist-tags',
  '15 4 * * *',
  $$ select public.cron_refresh_artist_tags(); $$
);

-- 5. Grant: anon/authenticated no necesitan llamar estas funciones.
-- Solo el cron daemon (con security definer) las ejecuta.
revoke all on function public.cron_prune_recommendation_cache() from public;
revoke all on function public.cron_refresh_artist_tags() from public;

comment on function public.cron_prune_recommendation_cache() is
  'Borra entradas de recommendation_cache con refreshed_at > 24h. Llamada por pg_cron diariamente.';
comment on function public.cron_refresh_artist_tags() is
  'Dispara POST a /functions/v1/enrich-tags con top 30 artistas de los ultimos 7 dias. Mantiene artist_tags fresco para auto-genre-mix matutino.';
