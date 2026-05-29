---
tipo: modulo
capa: meta
plataforma: backend
estado: estable
ultima-revision: 2026-05-28
archivo: supabase/migrations/20260527000001_daily_mix_cron.sql
tags: [cron, pg_cron, pg_net, vault, mantenimiento]
---

# Cron Jobs (pg_cron)

> Jobs nocturnos que mantienen los caches de recomendaciones sanos. Implementados con `pg_cron` + `pg_net` + `supabase_vault`. Vienen de la Fase 5.3.

## Migración fuente
`supabase/migrations/20260527000001_daily_mix_cron.sql`

## Extensiones requeridas

| Extensión | Versión | Para qué |
|---|---|---|
| `pg_cron` | 1.6.4 (ya activa) | Scheduler de jobs |
| `pg_net` | 0.8.0 (activada por la migración) | HTTP cliente desde Postgres |
| `supabase_vault` | 0.3.1 (ya activa) | Storage seguro de secrets |

## Jobs

### `ritmiq-prune-rec-cache @ 0 4 * * *` (04:00 UTC)

Función: `public.cron_prune_recommendation_cache()`.

```sql
delete from public.recommendation_cache
where refreshed_at < now() - interval '24 hours';
```

Justificación: el endpoint [[recommendations]] tiene TTL 12h hardcoded; cualquier entrada > 24h es definitivamente stale.

### `ritmiq-refresh-artist-tags @ 15 4 * * *` (04:15 UTC)

Función: `public.cron_refresh_artist_tags()`.

Pseudocódigo:

```
SELECT top 30 artistas con más plays en los últimos 7 días de play_history
SI hay >= 1 artista:
  POST /functions/v1/enrich-tags
    headers: { authorization: Bearer <vault.service_role_key> }
    body: { artists: [...] }
  pg_net fire-and-forget (timeout 30s)
```

Mantiene [[artist_tags]] fresco para que `auto-genre-mix` matutino cargue instantáneo sin esperar a Last.fm.

## Vault secrets

Ambas funciones leen credenciales desde `supabase_vault`:

| Secret name | Valor |
|---|---|
| `ritmiq_supabase_url` | `https://<project-ref>.supabase.co` |
| `ritmiq_service_role_key` | service_role JWT del proyecto |

Creados manualmente vía Management API (no en la migración para no commitear secrets):

```sql
select vault.create_secret('https://...supabase.co', 'ritmiq_supabase_url', '...');
select vault.create_secret('<service_role_jwt>', 'ritmiq_service_role_key', '...');
```

Si los secrets no existen, las funciones loggean `notice` y salen sin error (no rompen el cron).

## Permisos

Ambas funciones son `security definer` + `revoke all on function ... from public`. Solo el cron daemon (que corre con permisos del owner) las invoca.

## Verificación

```sql
-- Jobs activos
select jobid, jobname, schedule, active from cron.job where jobname like 'ritmiq-%';

-- Últimas ejecuciones
select * from cron.job_run_details
where jobname like 'ritmiq-%'
order by start_time desc limit 10;

-- Últimos POSTs disparados (cron_refresh_artist_tags)
select id, status_code, content_type, created
from net._http_response
order by id desc limit 5;
```

## Test manual

```sql
select public.cron_prune_recommendation_cache();
select public.cron_refresh_artist_tags();
```

Si todo está bien configurado, el segundo SELECT inserta una fila en `net._http_response` con status 200 a los pocos segundos.

## Limitaciones

- **UTC, no per-user timezone**. Para usuarios en zonas distintas, las 04:00 UTC no necesariamente caen en la madrugada local. Aceptable para el alcance actual; si se vuelve problema, implementar cron por user con su `profiles.timezone`.
- **Top 30 artistas global**, no por user. El cron refresca a los más populares de la base entera; usuarios con gustos nicho no se benefician del refresh nocturno directamente (pero sí del cache 30d cuando reproduzcan).

## Idempotencia

La migración es idempotente:

```sql
-- Unschedule previo antes del schedule actual
do $$
declare v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job
    where jobname in ('ritmiq-prune-rec-cache', 'ritmiq-refresh-artist-tags')
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end $$;
```

Re-aplicar la migración no duplica jobs.

## Qué rompe esto

| Cambio | Síntoma |
|---|---|
| Rotar el `service_role_key` sin updatear el vault | El POST a `/enrich-tags` recibe 401, no error visible al user |
| Borrar `pg_net` | `cron_refresh_artist_tags` lanza error; el prune sigue funcionando |
| Cambiar el horario a UTC noche EU | Usuarios en Asia ven el refresh a media tarde |

## Changelog

- 2026-05-27 — Creado en Fase 5.3. Commit `1187475`. Aplicado al proyecto remoto vía Management API.
