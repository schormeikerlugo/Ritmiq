---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-24
archivo: supabase/migrations/20260524000003_stream_url_cache.sql
tags: [supabase, tabla, p2p, cache, fase1]
created: 2026-05-23
migration: 20260524000003_stream_url_cache.sql
---

# stream_url_cache — Cache global de URLs efímeras (Fase 1)

> **RLS:** `any auth read` · Write solo via service_role (Edge)
> **TTL:** ~30 min (max 24h), URLs googlevideo expiran ~6h reales
> **Cron prune:** cada hora `0 * * * *`
> **Edge writer:** [[publish-stream-url]]
> **Edge reader:** [[get-stream-url]]

## Propósito

Cuando un desktop resuelve una URL de googlevideo via yt-dlp, la publica al cache global. Otros usuarios sin LAN propio pueden consumir esa URL sin tener que correr yt-dlp ellos mismos → reduce latencia de 1-3s a ~80-200ms.

Es el primer canal de sharing P2P de Ritmiq (Fase 1). Es complementario a [[tracks_global]] (Fase 2 — metadata) y al futuro Fase 4 (P2P bytes federado).

## Schema

```sql
create table public.stream_url_cache (
  yt_id        text primary key,
  url          text not null,
  content_type text default 'audio/mp4',
  expires_at   timestamptz not null,
  source       text check (source in ('desktop','edge','manual')),
  updated_at   timestamptz default now()
);
```

## Indices

```sql
create index idx_stream_url_cache_expires
  on stream_url_cache (expires_at);
```

## RLS

```sql
alter table public.stream_url_cache enable row level security;

create policy "stream_url_cache: any auth read"
  on public.stream_url_cache
  for select
  using (auth.role() = 'authenticated');
```

## Prune cron

```sql
select cron.schedule(
  'stream-url-cache-prune',
  '0 * * * *',
  'delete from public.stream_url_cache where expires_at < now();'
);
```

Cada hora a las :00 elimina URLs caducadas. Sin esto la tabla acumularía URLs muertas indefinidamente.

## Privacidad

| Columna | ¿Sensible? |
|---|---|
| `yt_id` | No (público de YouTube) |
| `url` | Efímera googlevideo, IP-locked en muchos casos |
| `content_type` | No |
| `expires_at` | No |
| `source` | No (solo revela tipo de origen) |
| `updated_at` | No |

**NO se comparten:** título, artista, duración, cover, `user_id`, device_id, IP.

## Triggers de publicación

1. **Desktop main — tras `getStreamUrl()` exitoso en lan-server**
   `apps/desktop/main/lan-server.js:resolveCached` → `publishToGlobalCache(ytId, url, expiresAt)`. Hook tras yt-dlp en cualquier ruta `/stream/`.

2. **Desktop main — tras `getStreamUrl()` via IPC directo**
   `apps/desktop/main/ipc.js:yt:streamUrl` → `publishResolvedUrl(ytId, url)`. Cubre el caso ephemeral (track de búsqueda fresca, sin pasar por LAN routing).

Ambos requieren:
- `VITE_SUPABASE_URL` o `SUPABASE_URL` en env.
- `VITE_SUPABASE_ANON_KEY` en env (para header `apikey`).
- `supabaseUserJwt` no null (JWT del usuario logueado, sincronizado desde renderer via IPC `settings:setSupabaseToken`).

## Stats observables (lan-server.js publishStats)

Objeto in-memory consultable via IPC `settings:getPublishStats`:

```js
{
  attempts: number,
  successes: number,
  failures: number,
  lastSuccessAt: number | null,
  lastError: { message, at } | null,
  skippedReason: 'no_url' | 'no_apikey' | 'no_session' | 'toggle_off' | null,
  hasUrl: boolean,
  hasToken: boolean,
  hasSession: boolean,
  toggleEnabled: boolean,
  streamCacheSize: number,
}
```

Visible en Settings → Reproducción → panel "Compartir resoluciones con la red Ritmiq".

## Toggle UX

`Settings → Reproducción → "Compartir resoluciones con la red Ritmiq"`
- Por defecto: ON (opt-out).
- Solo visible en Desktop (la PWA no puede ejecutar yt-dlp).
- Estado controlado por `useSettingsStore.publishUrlCache`.
- Sincronizado al main process via IPC `settings:setPublishUrlCache`.

## Botón "Vaciar caché local"

Settings → Reproducción → botón que invoca `lan:clearStreamCache` IPC. Vacía el cache de memoria del LAN server (TTL_MS=30min) → la próxima reproducción dispara `getStreamUrl` + publish. Útil para ver el publish en vivo sin esperar 30 min.

## Consume side

[[get-stream-url]] consultada por:
- `packages/ui/src/lib/use-player.js:getGlobalCachedUrl` — paso 3 del cascade de `resolveAudioSource`. Se ejecuta para CUALQUIER user con sesión Supabase válida, no solo para los que publican.

## Queries útiles

```sql
-- Estado del cache:
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE expires_at > now()) AS vigentes,
  MAX(updated_at) AS last_publish
FROM stream_url_cache;

-- Top 10 ytIds más recientes:
SELECT yt_id, source, EXTRACT(epoch FROM (expires_at - now()))::int AS ttl_left_s
FROM stream_url_cache
ORDER BY updated_at DESC
LIMIT 10;
```

## Cross-references

- [[publish-stream-url]] — Edge Function de escritura
- [[get-stream-url]] — Edge Function de lectura
- [[tracks_global]] — primo metadata-cache (Fase 2)
- [[p2p-knowledge-sharing]] — flujo completo
