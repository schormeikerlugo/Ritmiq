-- Ritmiq — Fase 3 (Variante A): purga diaria de cache de recomendaciones.
--
-- En vez de un pre-cómputo activo (que requeriría pg_net + edge function
-- callback con manejo de rate limit de Last.fm), simplemente borramos las
-- entradas que probablemente se sirvieron muy frías el día anterior. La
-- próxima abertura del Home las regenera limpio.
--
-- - Schedule: 04:00 UTC todos los días.
-- - Conserva entradas con < 11 horas de antigüedad (margen para no borrar
--   las recién creadas a las 17:00 UTC del día anterior — esas siguen
--   siendo útiles para usuarios cuya zona horaria recién amanece).

create extension if not exists pg_cron with schema extensions;

-- Job idempotente: si ya existe, lo redefine.
select cron.unschedule('rec-cache-daily-purge')
  where exists (select 1 from cron.job where jobname = 'rec-cache-daily-purge');

select cron.schedule(
  'rec-cache-daily-purge',
  '0 4 * * *',
  $$ delete from public.recommendation_cache
     where refreshed_at < now() - interval '11 hours' $$
);
