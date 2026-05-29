# Fase 5 — Recomendaciones backend ✓

Backend de recomendaciones más resiliente y contextual. Cache `artist_tags`
mantenido proactivamente, género real mostrado en la Home, mantenimiento
nocturno automático con `pg_cron`, y heurística de hora del día que reordena
las recomendaciones según el mood del usuario.

5 commits atómicos (4 features + 1 doc). Build PWA + AppImage verde en todos.

## Commits

| # | Commit | Hash | Resumen |
|---|---|---|---|
| 5.1 | `feat(recs): edge function enrich-tags` | `894b44d` | Endpoint dedicado para pre-poblar `artist_tags` + cliente helper. |
| 5.2 | `feat(home): mix por genero real con pre-enrich` | `b769edf` | Display capitalizado del género + fire-and-forget enrich al cargar Home. |
| 5.3 | `feat(recs): Daily Mix maintenance via pg_cron` | `1187475` | 2 cron jobs 04 UTC: prune cache stale + refresh artist_tags via pg_net. |
| 5.4 | `feat(home): heuristica hora del dia` | `bae3b42` | Reorder de tracks por mood + títulos contextuales según hora. |

## Cambios por área

### Backend nuevo (5.1)
- `supabase/functions/enrich-tags/index.ts`: POST batch (max 50 artistas), concurrencia 5, cache TTL 30d. Misma lógica `isAllowedTag` + `TAG_BLACKLIST` que el endpoint `recommendations`.
- `packages/ui/src/lib/enrich-tags.js`: cliente fire-and-forget con throttle 60s en localStorage.

### UI Home (5.2 + 5.4)
- `Home.jsx`:
  - Pre-enrich de los top 10 artistas del usuario en el `useEffect` que dispara las recs (sólo si `topArtists.length > 0`).
  - Display capitalizado del género dominante (`capitalizeTag`): `"hip-hop"` → `"Hip-Hop"`, `"rnb"` → `"R&B"`, `"edm"` → `"EDM"`.
  - Subtitle dinámico de la fila Mix: "Tu género más escuchado: Indie Rock" o "Calculando tu género dominante…".
  - `genreRec` y `discoverRec` pasan por `reorderByMood` (useMemo) según `getMoodBias()`.
  - Título y subtitle de "Para descubrir" cambian con la hora del día.
- `packages/ui/src/lib/time-of-day.js` (nuevo):
  - 4 franjas horarias.
  - `reorderByMood` no filtra (preserva variedad), solo reordena con bias suave ±1.0.
  - `trackMoodScore` lee `track.tags`; hoy retorna 0 porque el server no devuelve tags por track. **Puerta trasera**: cuando se añadan, el reordering se vuelve efectivo automáticamente sin cambios en este lib.
  - `getGreeting()` reemplaza el duplicado local.

### Cron nocturno (5.3)
- `supabase/migrations/20260527000001_daily_mix_cron.sql`:
  - `create extension pg_net` (HTTP cliente Postgres).
  - 2 jobs `cron.schedule`:
    - `ritmiq-prune-rec-cache @ 0 4 * * *`: borra entradas de `recommendation_cache` con `refreshed_at > 24h`.
    - `ritmiq-refresh-artist-tags @ 15 4 * * *`: top 30 artistas de los últimos 7d → POST batch a `/enrich-tags` via `pg_net`.
  - Funciones `security definer` + `revoke all from public` (solo el cron las llama).
  - Credenciales desde `supabase_vault` (secrets `ritmiq_supabase_url` + `ritmiq_service_role_key`).
  - Si los secrets no existen, las funciones loggean y salen sin error.
  - Idempotente (`cron.unschedule` previo en el `do $$ ... $$` block).

## Bundle impact

| Stage | Precache | Delta vs Fase 4 |
|---|---|---|
| Tras 5.1 (lib client) | 2313 KiB | +2 KiB |
| Tras 5.2 (capitalize + pre-enrich call) | 2315 KiB | +1.6 KiB |
| Tras 5.3 (solo backend) | 2315 KiB | sin cambio |
| Tras 5.4 (time-of-day) | 2317 KiB | +1.6 KiB |
| **Total Fase 5** | **2317 KiB** | **+6 KiB vs 2311** |

## Deploys aplicados

```bash
# Edge function (CLI):
supabase functions deploy enrich-tags --project-ref gukzacuwcaqgkzchghcg

# Migración + cron (Management API):
# POST /v1/projects/<ref>/database/query con el SQL completo

# Vault secrets (Management API):
vault.create_secret('https://...supabase.co', 'ritmiq_supabase_url', '...')
vault.create_secret('<service_role_jwt>', 'ritmiq_service_role_key', '...')
```

Verificación post-deploy:
- `cron.job` muestra 2 jobs activos (`jobid 7, 8`).
- Test manual: `select public.cron_refresh_artist_tags();` → 1 POST registrado en `net._http_response` con status `200`.
- Tracked en `supabase_migrations.schema_migrations`: `20260527000001`.

## Verificación manual desde la app

### 5.1 + 5.2
1. Abrir Home con usuario que tenga historial.
2. Fila "Mix de X" muestra el género real capitalizado.
3. DevTools → Network: POST a `/functions/v1/enrich-tags` al cargar Home (fire-and-forget).
4. Reload → mismo POST no se vuelve a disparar antes de 60s (throttle).

### 5.3
- Setting de la hora del sistema a 04:00 UTC y esperar (o disparar manualmente via SQL):
  ```sql
  select public.cron_prune_recommendation_cache();
  select public.cron_refresh_artist_tags();
  ```
- Verificar `net._http_response` last 5 min con status 200.

### 5.4
1. Cambiar la hora del SO a 8 AM → la fila "Para descubrir" cambia título a "Para empezar el día".
2. Hora del SO a 23 PM → título "Para acompañar la noche".
3. Hora 14 PM → título genérico "Para descubrir".

## Limitaciones conocidas

- **`reorderByMood` actualmente no tiene efecto observable** porque el server no devuelve `track.tags` en `RecTrack`. Cuando se añada (Fase 6 multi-fuente, o un commit dedicado), el reordering se activa automáticamente.
- **`pg_cron` corre en UTC**. Para usuarios en zona horaria distinta, el cron a las 04 UTC podría no caer en la madrugada local. Aceptable para el alcance actual; si se vuelve problema, hacer el cron por user con su `timezone` del perfil.
- **Vault secrets son globales del proyecto**, no por usuario. La service_role_key tiene permisos elevados — rotar si se filtra.

## Siguiente fase

**Fase 6 — Multi-fuente recs (OPCIONAL)** (3 commits, ~14h):
- 6.1 Fuente YouTube Music Innertube
- 6.2 Scoring híbrido
- 6.3 Spotify Web API OAuth opcional

Decidido al inicio del plan general: **diferida al final**. Saltar a **Fase 7 — Performance** que es más impactante.
