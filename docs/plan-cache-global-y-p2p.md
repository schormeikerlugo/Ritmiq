# Plan: Cache Global de URLs + Storage de Bytes + P2P Federado

> Plan aprobado el 2026-05-22. Implementacion por fases sin regresion del
> comportamiento actual. Las capas nuevas se insertan ENTRE el LAN del
> owner y el fallback cloud edge. Si todo lo nuevo falla, la app se
> comporta exactamente como hoy.

## Decisiones tomadas

| Decision | Valor |
|---|---|
| Orden de fases | Fase 1 -> Fase 2 -> evaluar Fase 4 con datos |
| Privacy default | ON con opt-out claro en Ajustes |
| Costes Supabase | Plan Free + LRU eviction automatico |
| Cuando ejecutar Fase 4 | Solo si hit rate combinado 1+2 < 85% tras 2 semanas |

---

## Mapa de capas — antes y despues

### Cascada actual (hoy)

```
PWA pide reproducir track ytId=ABC
  |
  1. ¿IndexedDB local-blob?                   [PWA descargado]
  |
  2. ¿LAN/Tunnel del owner alcanzable?
  |     |
  |     a) SQLite tracks (downloaded)
  |     b) shared_audio (cross-account)
  |     c) streamCache memoria 30 min
  |     d) yt-dlp resuelve URL googlevideo
  |
  3. Fallback: Edge resolve-stream (Innertube)
```

### Cascada nueva (tras las tres fases)

```
PWA pide reproducir track ytId=ABC
  |
  1. ¿IndexedDB local-blob?                   [paso 1 INMUTABLE]
  |
  2. NUEVO Fase 2: ¿shared_audio_index en Supabase Storage?
  |     -> URL signed CDN, latencia ~50-100 ms
  |
  3. ¿LAN/Tunnel del owner alcanzable?        [sin cambios]
  |     -> a/b/c/d como hoy
  |
  4. NUEVO Fase 1: ¿stream_url_cache tiene URL fresca?
  |     -> fetch directo googlevideo, latencia ~30 ms
  |
  5. NUEVO Fase 4: ¿Algun Hoster amigo online tiene este ytId?
  |     -> request a su lan-server via Tunnel/Tailscale del amigo
  |
  6. Fallback: Edge resolve-stream (igual que hoy)
```

Capas 1 y 3 quedan **identicas**. Capas 2, 4 y 5 son **nuevas**. Capa 6 es el fallback de siempre.

---

## FASE 1 — Cache global de URLs (PRIMERA EJECUCION)

### Tiempo total: ~6 h

### 1.1 Migration Supabase

**Archivo nuevo:** `supabase/migrations/202605XX000000_stream_url_cache.sql`

```sql
create table public.stream_url_cache (
  yt_id        text primary key,
  url          text not null,
  content_type text not null default 'audio/mp4',
  expires_at   timestamptz not null,
  source       text not null default 'desktop' check (source in ('desktop','edge','manual')),
  updated_at   timestamptz not null default now()
);

create index idx_stream_url_cache_expires on public.stream_url_cache(expires_at);

alter table public.stream_url_cache enable row level security;

create policy "stream_url_cache: any auth read"
  on public.stream_url_cache for select
  using (auth.role() = 'authenticated');

-- Cron de limpieza horario
select cron.schedule(
  'stream-url-cache-prune',
  '0 * * * *',
  $$ delete from public.stream_url_cache where expires_at < now(); $$
);
```

### 1.2 Edge Function `publish-stream-url`

**Archivo nuevo:** `supabase/functions/publish-stream-url/index.ts`

- POST con `{ ytId, url, contentType, expiresAt }`.
- Valida JWT del Bearer.
- Usa `SUPABASE_SERVICE_ROLE_KEY` para upsert.
- Rate-limit 100 upserts/min/user.

### 1.3 Edge Function `get-stream-url`

**Archivo nuevo:** `supabase/functions/get-stream-url/index.ts`

- GET con `?ytId=ABC`.
- Valida JWT.
- SELECT `expires_at > now() + interval '30 seconds'`.
- HIT -> `{ url, contentType, expiresAt, source: 'cache' }`.
- MISS -> 404 `{ url: null }`.
- HTTP header `Cache-Control: public, max-age=60`.

### 1.4 Hook en `apps/desktop/main/lan-server.js`

Dentro de `resolveCached`, tras `streamCache.set(ytId, ...)` (linea ~428):

```js
if (publishUrlCacheEnabled) {
  publishToGlobalCache(ytId, url, expiresAt).catch((err) => {
    console.warn(`[lan-server] publish stream-url fallo (no fatal): ${err.message}`);
  });
}
```

Nueva helper `publishToGlobalCache(ytId, url, expiresAt)` que hace fetch
POST a `${SUPABASE_URL}/functions/v1/publish-stream-url` con Bearer del
owner. Toggle via env var `RITMIQ_PUBLISH_URL_CACHE=true|false`.

### 1.5 Hook en `packages/core/src/audio-source.js`

Anadir capa entre LAN y cloud-edge:

```js
export async function resolveAudioSource(track, deps) {
  // 1. Local descargado (sin cambios)
  const localUrl = await deps.getLocalUrl(track.id);
  if (localUrl) return { url: localUrl, origin: 'local-blob' o 'local-file' };

  // 2. LAN/Tunnel (sin cambios)
  const lanBase = await deps.getLanBaseUrl();
  if (lanBase) { /* ... como hoy ... */ }

  // 3. NUEVO Fase 1: cache global URLs
  if (track.ytId && deps.getGlobalCachedUrl) {
    const cached = await deps.getGlobalCachedUrl(track.ytId);
    if (cached?.url) {
      return { url: cached.url, origin: 'cache-global-url' };
    }
  }

  // 4. Fallback cloud (sin cambios)
  const { url, expiresAt } = await deps.resolveCloudStream(track.id);
  return { url, origin: 'cloud-stream', expiresAt };
}
```

### 1.6 Hook en `packages/ui/src/lib/use-player.js`

En `buildResolveDeps` anadir prop nueva:

```js
getGlobalCachedUrl: async (ytId) => {
  if (!ytId) return null;
  const sup = import.meta.env.VITE_SUPABASE_URL;
  if (!sup) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const r = await fetch(
      `${sup}/functions/v1/get-stream-url?ytId=${encodeURIComponent(ytId)}`,
      { headers: { Authorization: `Bearer ${session.access_token}` } }
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
},
```

### 1.7 Toggle UI

`packages/ui/src/components/SettingsView/sections/PlaybackSection.jsx` (o
equivalente). Nueva fila en seccion Sincronizacion:

- **Compartir resoluciones con la red Ritmiq** [toggle ON/OFF]
- Texto: "Cuando tu PC resuelve una cancion, otros usuarios sin acceso a
  tu equipo podran escucharla al instante. No se comparte tu identidad
  ni que escuchas."

Persistido en `packages/ui/src/stores/settings.js`. IPC handler nuevo
`settings:getPublishUrlCache` leido por lan-server.js.

### 1.8 Panel Diagnostico

`packages/ui/src/components/SettingsView/sections/DiagnosticView.jsx`:

- "Cache global URLs": HIT / MISS contadores sesion.
- "Ultima publicacion al cache": timestamp + ytId.
- Boton "Probar lectura del cache".

### 1.9 Checklist pre-deploy

- [ ] Migration aplica sin errores (`supabase migration up`).
- [ ] Edge Functions deploy (`supabase functions deploy publish-stream-url get-stream-url`).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` configurada en project.
- [ ] Desktop arranca sin errores con/sin Supabase reachable.
- [ ] PWA arranca sin errores con/sin acceso a Edge Functions.
- [ ] Cascada cliente: si Edge falla -> cae a cloud edge -> reproduce.
- [ ] Cascada desktop: si publish remoto falla -> streamCache local funciona.

---

## FASE 2 — Cache global de bytes (Storage)

### Tiempo total: ~8 h

### 2.1 Migration

**Archivo nuevo:** `supabase/migrations/202605XX000001_shared_audio_global.sql`

```sql
create table public.shared_audio_index (
  yt_id          text primary key,
  storage_path   text not null,
  mime           text not null,
  size           bigint not null,
  hash_sha256    text,
  uploaded_by    uuid references auth.users(id) on delete set null,
  uploaded_at    timestamptz not null default now(),
  access_count   integer not null default 0,
  last_accessed  timestamptz not null default now()
);

create index idx_shared_audio_last_accessed on public.shared_audio_index(last_accessed);
create index idx_shared_audio_uploaded_at on public.shared_audio_index(uploaded_at);

alter table public.shared_audio_index enable row level security;

create policy "shared_audio_index: any auth read"
  on public.shared_audio_index for select
  using (auth.role() = 'authenticated');

create or replace function public.shared_audio_touch(p_yt_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shared_audio_index
  set access_count = access_count + 1, last_accessed = now()
  where yt_id = p_yt_id;
$$;
```

### 2.2 Bucket Storage

Configuracion en Supabase Dashboard:
- Bucket: `shared-audio`
- Public: NO
- Allowed MIME: `audio/mp4`, `audio/x-m4a`
- File size limit: 50 MB
- Policies: solo service_role lee/escribe directo, clientes leen via signed URL.

### 2.3 Edge Function `upload-shared-audio`

- Recibe multipart/stream del desktop.
- Auth JWT.
- Upload al bucket via service_role.
- INSERT idempotente en `shared_audio_index`.

### 2.4 Edge Function `get-shared-audio`

- GET `?ytId=ABC`.
- Auth JWT.
- SELECT `shared_audio_index`.
- HIT: llama `shared_audio_touch(ABC)` + genera signed URL TTL 1h.
- MISS: 404.

### 2.5 LRU Eviction (cron diario)

Edge Function `prune-shared-audio` corre cada noche 3am:
- Si suma `size` > 950 MB:
- Ordenar por `last_accessed ASC`.
- Borrar 10% mas viejo (bucket + tabla).
- Log de archivos eliminados.

```sql
select cron.schedule(
  'shared-audio-lru',
  '0 3 * * *',
  $$ select net.http_post(
       url := 'https://<project>.supabase.co/functions/v1/prune-shared-audio',
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
     ); $$
);
```

### 2.6 Hook en `downloadSharedAudio` (lan-server.js)

Tras `registerSharedAudio(db, ...)`:

```js
if (publishBytesCacheEnabled) {
  uploadToGlobalCache(ytId, finalPath, size).catch((err) => {
    console.warn(`[lan-server] upload shared-audio fallo (no fatal): ${err.message}`);
  });
}
```

### 2.7 Hook en `audio-source.js`

Nueva capa **antes** del LAN:

```js
// 1. local-blob (sin cambios)
const localUrl = await deps.getLocalUrl(track.id);
if (localUrl) return { url: localUrl, origin: 'local-blob' };

// 2. NUEVO Fase 2: Storage global
if (track.ytId && deps.getGlobalCachedBytes) {
  const cached = await deps.getGlobalCachedBytes(track.ytId);
  if (cached?.url) return { url: cached.url, origin: 'cache-global-bytes' };
}

// 3. LAN/Tunnel (sin cambios)
// 4. Fase 1: cache URLs
// 5. Cloud edge
```

### 2.8 Toggle + UI

Settings:
- "Compartir descargas con la red Ritmiq" [toggle ON/OFF]
- Default ON.
- Si OFF: NO sube, pero SI puede leer del cache ajeno.
- Texto: "Tus descargas anonimas ayudan a otros. Solo se comparte el
  archivo m4a, no tu identidad ni metadata."

### 2.9 Checklist pre-deploy

- [ ] Bucket con politicas correctas.
- [ ] Tamano monitorizable desde Diagnostico.
- [ ] Cron LRU corre sin romper accesos en curso.
- [ ] Hash SHA256 al subir y al leer.
- [ ] Privacy review: `uploaded_by` no se expone.

---

## FASE 4 — P2P federado entre desktops (POSPUESTA)

### Tiempo total: ~12 h

Decision por datos: ejecutar solo si tras 1-2 semanas de Fase 1+2 el hit
rate combinado < 85%.

### 4.1 Migration `p2p_grants`

```sql
create table public.p2p_grants (
  host_user_id  uuid not null references auth.users(id) on delete cascade,
  guest_user_id uuid not null references auth.users(id) on delete cascade,
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  primary key (host_user_id, guest_user_id)
);

alter table public.p2p_grants enable row level security;
```

### 4.2 Endpoint `/p2p-stream/:ytId` en lan-server

- Valida `guest_token` (JWT Supabase del solicitante) via Edge call.
- Verifica amistad mutua + grant activo.
- Resuelve con cascada normal.
- Rate-limit: max 2 streams concurrentes per-friend, 5 globales.
- Log en `activity_log`.

### 4.3 Edge Function `verify-friend`

- Recibe `{ hostUserId, guestUserId, guestToken }`.
- Valida JWT del guest.
- Verifica `mutual_friends` + `p2p_grants` activo.
- Devuelve `{ ok: true/false }`.

### 4.4 Cliente: suscripcion a amigos online

PWA mantiene `Map<friendId, { url, accessToken, lastPing }>`:
- Al iniciar, query `presence` + `mutual_friends`.
- Realtime sub a cambios.

### 4.5 Cliente: integracion cascade

En `audio-source.js`, entre Fase 1 y cloud-edge:

```js
if (track.ytId && deps.getFriendStreamUrl) {
  const friend = await deps.getFriendStreamUrl(track.ytId);
  if (friend?.url) return { url: friend.url, origin: 'p2p-friend' };
}
```

### 4.6 UI Settings consent

- Lista togglable "Amigos que pueden usar tu desktop".
- Panel actividad "Tu desktop sirve ahora: Juan reproduce ABC" con boton pausar.

---

## Garantias de no-regresion

| Garantia | Como se asegura |
|---|---|
| Tracks descargados localmente (PWA IndexedDB) NUNCA tocan red | Paso 1 inmutable |
| LAN del owner sigue siendo prioridad sobre capa cloud nueva | Paso 3 sin cambios; Storage solo como atajo SI no hay LAN |
| `shared_audio` local SQLite del owner sigue cubriendo cross-account | No se toca `findSharedAudio` |
| `streamCache` memoria 30 min sigue siendo cache "hot" del desktop | No se toca, solo publish fire-and-forget |
| Edge `resolve-stream` sigue como ultimo recurso, no se elimina | Inmutable |
| Sign-stream HMAC sigue siendo el camino de auth a LAN | Inmutable |
| Cualquier nueva capa falla -> cae transparente al siguiente nivel | try/catch alrededor de cada call |
| Toggle desactivado -> comportamiento identico a hoy | flag global gate |
| Sin cambios en flujo descarga PWA -> IndexedDB offline-first | Paso 1 + IndexedDB intactos |
| Sin cambios en pareo de device + access tokens | Inmutable |

---

## Orden de ejecucion aprobado

1. **Fase 1 completa** (~6 h) — cuando estemos listos.
2. **Verificar 1-2 semanas en uso real** — medir hit rate.
3. **Fase 2 completa** (~8 h) — si Fase 1 estable.
4. **Verificar 1-2 semanas mas**.
5. **Fase 4** (~12 h) — SOLO si hit rate combinado < 85%.

Tiempo total potencial: **~26 h** distribuidas en sprints de 1-2 semanas.
