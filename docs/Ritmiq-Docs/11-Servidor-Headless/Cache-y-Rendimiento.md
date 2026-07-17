---
tipo: modulo
capa: servidor
plataforma: ambas
estado: estable
ultima-revision: 2026-07-17
archivo: packages/server-core/src/lan-server.js
tags: [servidor, cache, rendimiento, prewarm, yt-dlp, concurrencia]
---

# Caché y rendimiento (Fases A-D)

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

### 4. Búsqueda por query (Fase A2)

`/yt/search` cachea los `items` por query normalizada (TTL 10min, LRU 200, dedupe
inflight). Búsqueda repetida: 2.0s → ~0.001s.

## Prewarm

- `/yt/prewarm?q=<ytId>` → pre-resuelve la URL (prioridad media, fire-and-forget).
- `&download=1` (Fase D1) → **descarga el m4a completo** a `shared-audio/` en una
  cola de baja concurrencia (`schedulePrewarmDownload`). Play instantáneo y
  permanente (no expira).
- Cliente (`lan-client.js` `prewarmStream(ytId, { download })`): la vista de
  búsqueda prewarmea los primeros 5; el top-1 con `download`. Dedupe 5min.

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
