---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-27
archivo: supabase/migrations/20260527000000_lyrics_cache.sql
tags: [tabla, lyrics, cache, rls]
---

# `lyrics_cache`

> Cache global de letras (lrclib.net) indexado por hash de identidad de track. TTL implícito 30d para encontradas / 7d para no encontradas. Solo `service_role` escribe (vía Edge Function [[lyrics]]); cualquier `authenticated` lee.

## Migración
`supabase/migrations/20260527000000_lyrics_cache.sql:1`

## Schema

```sql
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
```

## Cache key

`sha256(artist::title::durationBucket5s)` calculado en la Edge Function [[lyrics]]. El bucket de duración a 5s tolera drifts entre fuentes.

## Payload estructura

```jsonc
{
  "found": true,                          // false si lrclib no encontró
  "synced": "[00:00.00]Line 1\n...",     // null si solo plain
  "plain":  "Line 1\nLine 2\n...",       // null si solo synced
  "instrumental": false,
  "source": "lrclib"
}
```

## RLS

```sql
alter table public.lyrics_cache enable row level security;

drop policy if exists "lyrics_cache_read" on public.lyrics_cache;
create policy "lyrics_cache_read"
  on public.lyrics_cache for select
  to authenticated
  using (true);

-- INSERT/UPDATE/DELETE: solo service_role (bypasea RLS).
```

Cualquier `authenticated` puede leer cualquier fila. **No** hay política de write — solo `service_role` puede escribir, y lo hace desde la Edge Function.

## TTL

No es un TTL real (sin pg_cron prune). Se interpreta en la Edge Function:

```ts
function isFresh(refreshedAt, found) {
  const elapsed = Date.now() - new Date(refreshedAt).getTime();
  const ttl = found ? 30 * 86400_000 : 7 * 86400_000;
  return elapsed < ttl;
}
```

Si `!isFresh`, la Edge Function vuelve a llamar a lrclib y hace UPSERT.

## Crecimiento esperado

Aproximadamente 1 fila por track único que algún usuario haya reproducido + abierto el panel de letras. Tamaño promedio por fila:

- `payload` con `synced`: ~3 KB
- `payload` con solo `plain`: ~1.5 KB
- `payload` con `found:false`: <500 bytes

Con 10k tracks únicos: ~25 MB. Aceptable para Supabase free tier.

## Pruning futuro (no implementado)

```sql
-- Cron mensual: borrar filas no tocadas en > 90 días.
delete from public.lyrics_cache where refreshed_at < now() - interval '90 days';
```

## Qué puede romper este cambio

| Cambio | Impacto |
|---|---|
| Cambiar el bucket de duración (5s → 10s) | Pierde efectividad del cache hasta TTL |
| Quitar `not null` de `payload` | Edge Function ya garantiza non-null; defensa en profundidad |
| Cambiar TTL en la edge sin update de docs | Confusión: queries devuelven datos "frescos" según la doc pero la edge los rechaza |

## Casos de borde

- **Tracks con título idéntico de artistas distintos**: distinto `artist` → distinto hash → cache separado. Correcto.
- **Concurrencia (2 clientes piden la misma letra simultáneamente)**: ambos hacen `SELECT` + `UPSERT`. El upsert es idempotente; uno gana, ambos leen el mismo payload eventualmente.

## Migration history

| Version | Fecha | Cambio |
|---|---|---|
| `20260527000000` | 2026-05-27 | Creación inicial. Fase 4.1, commit `1375f40`. Aplicada al remote el mismo día vía Management API. |
