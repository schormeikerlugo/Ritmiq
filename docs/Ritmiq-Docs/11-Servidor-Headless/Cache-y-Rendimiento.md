---
tipo: modulo
capa: servidor
plataforma: ambas
estado: estable
ultima-revision: 2026-08-11
archivo: packages/server-core/src/lan-server.js
tags: [servidor, cache, rendimiento, prewarm, yt-dlp, concurrencia, progresivo, innertube]
---

# Caché y rendimiento (Fases A-D + 1-4)

> Cómo el servidor minimiza el tiempo de respuesta (buscar → sonar) sacando
> `yt-dlp` del camino crítico mediante caché y prewarm. Meta: bajar de ~8s a
> <1-2s en el caso común.

## Diagnóstico (medido en el servidor)

| Etapa | Latencia | Nota |
|---|---|---|
| `/yt/search` (yt-dlp ytsearch) | ~2.0-2.4s | fijo (arranque proceso + red YouTube) |
| `/stream` resolve **cold** | ~3.2s | primer play de una canción nueva |
| `/stream` resolve **warm** (cache URL) | 0.14s | 2ª vez |
| archivo cacheado (`shared_audio`) | 0.004s | instantáneo |
| yt-dlp arranque puro | 431ms | por invocación |

El coste dominante es **lanzar un proceso yt-dlp nuevo** en cada búsqueda/play.
No es el runtime Deno ni el signature solving (medido: iguales). InnerTube
directo por HTTP es 8x más rápido pero ya no devuelve URLs usables (PO tokens),
así que yt-dlp sigue siendo necesario → la estrategia es **cachear + prewarm**.

## Capas de caché

### 1. Archivos (`shared_audio`) — local a cada host

- `<ytId>.m4a` en `shared-audio/` (`RITMIQ_DATA_DIR` o `userData`). Tabla
  `shared_audio` (PK `yt_id`). Se sirve en ~0.004s.
- **Global por videoId** (compartido entre todos los dispositivos del host).
  Es lo deseado: si alguien consiguió una canción, se sirve/sugiere a todos.
- **No** se replica entre desktop y servidor (cachés independientes). Ver
  migración abajo.

### 2. URLs de stream (in-memory, TTL 30min)

`streamCache` (Map por ytId). Fix Fase 4e: `resolveCached(ytId, priority, dlOpts)`
usa las cookies del solicitante en cache-miss (antes ignoraba las del device).

### 3. URLs globales (Supabase `stream_url_cache`)

`publishToGlobalCache` publica cada resolución. Única capa que "cruza" entre
hosts (URLs efímeras, no archivos). Ver [[get-stream-url]], [[publish-stream-url]].

**Fase 2 (2026-08) — LEER el global antes de yt-dlp:** `readGlobalCachedUrl`
consulta `stream_url_cache` (Edge `get-stream-url`) **antes** de invocar yt-dlp
en `resolveCached`, solo para clicks reales (prioridad ≥7). HIT = ahorra 1-3s
(URL que otro host ya resolvió, ~5h TTL). Timeout 1.5s; cae a yt-dlp si MISS.
Requiere sesión de owner en el servidor (ver más abajo, cuenta de servicio).

### 4. Búsqueda por query (Fase A2)

`/yt/search` cachea los `items` por query normalizada (TTL 10min, LRU 200, dedupe
inflight). Búsqueda repetida: 2.0s → ~0.001s.

## Prewarm

- `/yt/prewarm?q=<ytId>` → pre-resuelve la URL (prioridad media, fire-and-forget).
  **Dedupe servidor**: si ya hay archivo cacheado o URL vigente/inflight, no
  re-encola yt-dlp (evita los `resolve START` redundantes tras `CACHE HIT`).
- `&download=1` (Fase D1) → **descarga el m4a completo** a `shared-audio/` en una
  cola de baja concurrencia (`schedulePrewarmDownload`). Play instantáneo y
  permanente (no expira). **Límite de duración** `RITMIQ_PREWARM_MAX_DURATION_S`
  (default 1800 = 30min): no pre-descarga mixes/álbumes largos solos (el usuario
  aún puede descargarlos manualmente).
- Cliente (`lan-client.js` `prewarmStream(ytId, { download, wait, timeoutMs })`).

### Prewarm predictivo (Fase 3, 2026-08)

Objetivo: que el usuario casi nunca toque un cache-miss real.

- **3a — siguiente de la cola**: `use-player.js` pre-**descarga** (`download:1`)
  el track siguiente cuando hay servidor → el cambio de canción es SHARED HIT.
- **3b — búsqueda**: `SearchView` descarga completo (`download:1`) los **top-3**
  (antes solo top-1); el resto (4-5) solo resuelve URL.
- **3c — hover**: `onPointerEnter` en filas de Library (tracks no descargados) y
  PlaylistView pre-resuelve la URL al posar el cursor/dedo.

### `wait=1` (Fase iOS)

`/yt/prewarm?wait=1` → el endpoint hace `await resolveCached` antes de responder
204 (en vez de fire-and-forget). Lo usa el cliente móvil para garantizar la URL
lista antes de reproducir. Ver "Fix iOS" arriba.

## Acelerador InnerTube (Fase 4, DESACTIVADO por defecto)

`packages/yt/src/innertube.js` (`resolveStreamUrlInnertube`) resuelve la URL m4a
vía la API InnerTube móvil (IOS/ANDROID) sin yt-dlp (~200-600ms vs 1-3s).
Integrado en `resolveCached` antes de yt-dlp, con fallback robusto.

**Default OFF** (`RITMIQ_INNERTUBE_ACCEL=false`): verificado 2026-08 que YouTube
responde **400/403** a IOS/ANDROID/WEB sin PO tokens desde IPs normales; activarlo
solo añadiría ~1.7s antes de caer a yt-dlp. El código queda listo para reactivar
en caliente si YouTube afloja o se integran PO tokens. Es la técnica "estilo
Demus" (ver ADR-035).

## Descarga: m4a nativo + anti-throttle (fix 2026-07)

`downloadAudio` (`packages/yt/src/ytdlp-wrapper.js`) descargaba con
`-x --audio-format m4a`, que **transcodifica** con ffmpeg (baja opus y re-encoda)
→ ~2.4x más lento (medido: 11.9s vs 4.9s). Además googlevideo **throttlea** la
conexión única tras los primeros MB (descargas de 12-105s).

Fix:
- **m4a nativo directo**: `-f bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/...`
  con `--remux-video m4a` (remux sin re-encode si ya es AAC). Sin ffmpeg salvo
  fallback. Los destinos opus/mp3 (desktop) mantienen `-x`.
- **`--http-chunk-size 1M`**: descarga por chunks con Range → resetea el
  throttle de googlevideo por chunk (medido: 5.7s con chunks vs 12-32s sin).
- El JS runtime (Deno) descifra el n-parameter, complemento del anti-throttle.

> **Nota**: el throttle de googlevideo es variable/intermitente; los chunks lo
> mitigan pero no lo eliminan. El prewarm anticipado (descarga en background) +
> caché hacen que el usuario perciba reproducción instantánea igualmente.

## Cache-miss en `/stream`: servido PROGRESIVO (Fase 1, 2026-08)

> **Reemplaza** el diseño previo "descargar completo antes de servir" (que daba
> TTFB ~6-12s). Ver [[Reproduccion-Servidor-24-7]] para el detalle completo.

En cache-miss, el path `/stream/yt:` ahora:
1. Resuelve **solo la URL** (`resolveCached`, con Fase 2 global + InnerTube).
2. Si es **m4a nativo** (`isNativeM4aUrl`) → `proxyAudioWithCache`: proxy en vivo
   googlevideo→cliente (primer byte inmediato) **+ tee a disco en paralelo**.
   Anti-502: fetch con Range + timeout de primer byte (4s, configurable
   `RITMIQ_PROXY_FIRST_BYTE_TIMEOUT_MS`); el servidor reenvía bytes al túnel al
   instante, Cloudflare no ve backend colgado.
3. **Garantía de cache** paralela: `schedulePrewarmDownload` (yt-dlp chunks).
4. **Fallback** sin regresión: no-m4a o proxy sin primer byte → `downloadSharedAudio`.

TTFB cache-miss: **~6-12s → ~1-3s**. Verificado vía túnel sin 502.

### Fix iOS (móvil no reproducía canciones nuevas)

iOS Safari aborta si el primer byte tarda (~4s por túnel+celular). El cliente
**móvil** hace `await prewarmStream(ytId, { wait: true })` antes de `<audio>.src`:
`/yt/prewarm?wait=1` hace `await resolveCached` y deja la URL lista en
`streamCache`. Cuando iOS pide bytes → TTFB ~0.2-1s → no aborta. Desktop no usa
`wait` (LAN local rápido). Ver `use-player.js` `loadAndPlayCurrent`.

## Descargas del cliente (offline): incluir el servidor

`getReachableLanBaseUrl()` (`lan-client.js`, usada por `downloadTrackToLocal`)
**incluía solo LAN/túnel del desktop**, así que las descargas caían siempre a la
Edge `resolve-stream` que YouTube bloquea (502 "descargas desde la nube").
Fix (2026-07): ahora incluye el **servidor 24/7** ordenado por `serverMode`, y
hace auto-pareo silencioso si falta `device_token`.

## Concurrencia (Fase C1)

`MAX_CONCURRENT` escala con los cores (mitad, acotado 3-8), configurable con
`RITMIQ_YTDLP_CONCURRENCY`. El servidor casero (16 cores) usa 8 → prewarms en
paralelo sin penalizar el click (que tiene prioridad y salta la cola).

## Servidor como host primario (Fase A1)

`use-player.js` `orderCandidates`: modo `auto` (default) prioriza el **servidor
24/7** (donde vive el caché). Nuevos modos: `prefer-desktop` (tu PC primero),
`prefer-server` (alias de auto), `fastest` (carrera). `preferredBase()` en
`lan-client.js` respeta el modo para search/prewarm/shared-cache-check.

## Warm-up del túnel (Fase C2)

`startTunnelKeepalive` calienta el túnel del servidor 24/7 (host primario) en
`visibilitychange`, evitando el cold-start (~1-3s) del primer play.

## Cookies del owner en el servidor

El servidor headless no tiene navegador, así que usa un **archivo de cookies
Netscape** (`RITMIQ_YTDLP_COOKIES_FILE`) como cookies del owner (fallback para
usuarios sin cookies propias). Mejora fiabilidad (evita bot-checks) y da acceso a
contenido ligado a la cuenta.

- Origen: el cookies file cacheado por el **desktop** (Firefox logueado en
  YouTube), en `/tmp/ritmiq-yt-cookies.txt`. Se transfiere al volumen del
  servidor como `/data/owner-cookies.txt` (chmod 600) y se apunta la variable.
- **Nunca se commitea** (es un secreto). Regenerar cuando caduquen: exportar de
  nuevo desde el navegador (`--cookies-from-browser firefox --cookies <file>`) y
  re-copiar al volumen.
- Log de arranque: `[lan-server] yt-dlp cookies file (env): /data/owner-cookies.txt`.

## Cuenta de servicio (owner del servidor headless)

Para que el cache global funcione (leer Fase 2 + publicar), el servidor necesita
una **sesión Supabase** que alimente `supabaseUserJwt` del lan-server. El
servidor headless no tiene renderer, así que `apps/server/src/index.js` obtiene
el JWT vía `endpoint-registry.getOwnerAccessToken()` y lo inyecta con
`setSupabaseUserJwt`, refrescándolo cada 30min.

**Se usa una CUENTA DE SERVICIO DEDICADA** (`servidor@ritmiq.org`, user_id
`54905c8d-…`), NO la cuenta personal del dueño — así el servidor no crea
sesiones ni asocia datos del cache global a un usuario real. Config en
`apps/server/.env` (chmod 600, nunca en el repo):

```
RITMIQ_OWNER_EMAIL=servidor@ritmiq.org
RITMIQ_OWNER_PASSWORD=…            # (o RITMIQ_OWNER_ACCESS_TOKEN)
```

Crear la cuenta con el admin API de Supabase (`POST /auth/v1/admin/users` con
service_role, `email_confirm:true`). Log de arranque al activarse:
`[endpoint-registry] autenticado como dueño: servidor@ritmiq.org` +
`[ritmiq-server] JWT del dueño sincronizado (cache global URL activo)`.

Sin credenciales, el comportamiento es idéntico a antes (cae a yt-dlp; no lee ni
publica el global). Ver [[Autenticacion-y-JWT]] y `apps/server/.env.example`.

## Migración del caché desktop → servidor

`apps/server/src/import-shared-cache.js`: escanea `shared-audio/` y registra cada
`<ytId>.m4a` en `shared_audio` (INSERT inline, idempotente, solo m4a/mp4). Usado
para migrar ~2.2GB (236 canciones) del caché del desktop al servidor.

```bash
# 1. tar de los .m4a del desktop → transferir al servidor → extraer en /data/shared-audio
# 2. re-indexar dentro del contenedor:
docker exec ritmiq-server sh -c "cd /app/apps/server && node src/import-shared-cache.js"
```

> Solo migra m4a (servibles en iOS); los .opus (descargas del owner) no, porque
> iOS/Safari no los reproduce.

## Resultados (vía túnel `ritmiq.org`)

- search cache HIT ~0.8s · play tras prewarm ~0.9s · archivo cacheado ~0.8s
  (dominado por el round-trip del túnel, ya no por yt-dlp).

## Ver también

- [[lan-server]], [[Multi-Endpoint-y-Seleccion-Host]], [[Reproduccion-Servidor-24-7]].
- [[get-stream-url]], [[publish-stream-url]].
