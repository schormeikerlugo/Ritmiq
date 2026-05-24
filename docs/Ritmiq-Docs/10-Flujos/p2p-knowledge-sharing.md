---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-24
tags: [flujo, p2p, knowledge-base, fase1, fase2]
created: 2026-05-24
---

# P2P Knowledge Sharing — Sistema de inteligencia colectiva Ritmiq

> El sistema P2P de Ritmiq tiene 3 capas: URLs efímeras (Fase 1), metadata canónica (Fase 2), y bytes federados (Fase 4, pendiente). Esta nota documenta la arquitectura completa y cómo interactúan.

## Visión

Cada acción de un usuario contribuye al ecosistema sin coste para él y sin comprometer su privacidad:

- **Reproduce** una canción → su URL googlevideo se publica a [[stream_url_cache]] (Fase 1).
- **Reproduce o descarga** → su metadata se canoniza en [[tracks_global]] (Fase 2).
- **Busca** → ve primero canciones que la red ya conoce, con metadata limpia y consistente.

A medida que crece el uso → más URLs cacheadas → menos llamadas a yt-dlp → menos rate-limit risk. Y más metadata canonizada → búsqueda más limpia → mejor descubrimiento.

## Capas

### Fase 1 — Cache de URLs efímeras

| Componente | Propósito |
|---|---|
| [[stream_url_cache]] | Tabla con `yt_id → url googlevideo + expires_at` |
| [[publish-stream-url]] | Edge writer (JWT user, rate-limit 200/min) |
| [[get-stream-url]] | Edge reader (cache CDN 60s, TTL margin 30s) |
| [[clean-track-meta]] | NO aplica (cache de URL no metadata) |
| Toggle UX | `Settings → Reproducción → "Compartir resoluciones con la red Ritmiq"` (ON por defecto, solo desktop) |

**Beneficio para el consumidor:** ahorra 1-3s de yt-dlp. Latencia ~80-200ms.

### Fase 2 — Diccionario de metadata canónica

| Componente | Propósito |
|---|---|
| [[tracks_global]] | Tabla con `yt_id → {title, artist, album, cover, duration, contribution_count}` |
| [[publish-track-meta]] | Edge writer canonicalizante (first-write-wins) |
| [[search-youtube]] | Edge reader paso 0 (devuelve `known[]` antes de Innertube) |
| [[clean-track-meta]] | Utility de limpieza canónica (defense-in-depth en 4 capas) |
| UI badge | `✨ Conocida en Ritmiq` / `✨ N reproducciones` en SearchView |

**Beneficio para el buscador:** ve canciones canonizadas arriba, con metadata limpia y consistente, en lugar de "(Official Music Video) [4K Upgrade]".

### Fase 4 — P2P bytes federado (pendiente)

WebRTC entre desktops Ritmiq. Compartir bytes directamente sin pasar por Supabase Storage. Requiere signaling server + NAT traversal. **No implementado.**

## Cascade de reproducción (audio-source.js)

Cuando un usuario reproduce un track, `resolveAudioSource` corre este cascade:

```
1. getLocalUrl           ← descargado en su propio device
2. getLanBaseUrl         ← LAN server del desktop pareado
3. getGlobalCachedUrl    ← cache global cross-user (Fase 1)
4. resolveCloudStream    ← fallback Edge resolve-stream (yt-dlp)
```

Solo si los pasos 1, 2, 3 fallan, se va a yt-dlp. El paso 3 introduce el HIT cross-user — si user1 publicó la URL hace ≤6h, user2 la reusa transparentemente.

## Flujo de contribución (auto-publish)

### Cuando alguien REPRODUCE una canción

```
User1 reproduce track
  ↓
backend.play() OK en use-player.js
  ↓
publishTrackMeta(track)                  → Fase 2 — POST publish-track-meta
publishToGlobalCache(ytId, url, ttl)     → Fase 1 — POST publish-stream-url
                                            (solo si yt-dlp se invocó)
```

Ambos fire-and-forget. Cero impacto en latencia de reproducción.

### Cuando alguien DESCARGA una canción

```
User1 descarga track con yt-dlp
  ↓
downloadAudio() OK en ipc.js
  ↓
publishTrackMetaFromMain(meta)           → Fase 2 — POST publish-track-meta
                                            (señal MUY fuerte: invirtió disco)
```

### Defensa en profundidad: cleaning aplicado en 4 capas

La utility [[clean-track-meta]] se aplica en cada punto donde la metadata fluye hacia tracks_global o tracks:

1. **[[search-youtube]] extractItems** — limpia en la raíz. Ningún cliente recibe nunca títulos sucios.
2. **[[publish-track-meta]] antes de INSERT** — defensa por si llega título sucio de cliente legacy.
3. **`apps/desktop/main/ipc.js` cleanMetaInPlace** — para pegar URL directo (bypass de search).
4. **`packages/ui/src/lib/api.js` persistFromMeta** — análogo para PWA.

Idempotencia garantizada: aplicar cleaning N veces produce el mismo resultado.

## Diagrama completo

```
                          ┌─────────────────────┐
                          │  Usuario reproduce  │
                          │   o descarga track  │
                          └──────────┬──────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                ▼                                          ▼
   ┌──────────────────────┐                ┌──────────────────────────┐
   │  publishTrackMeta()  │                │  publishToGlobalCache()  │
   │  fire-and-forget     │                │  fire-and-forget         │
   └──────────┬───────────┘                │  (si yt-dlp se invoco)   │
              │                            └──────────────┬───────────┘
              │ cleanYoutubeTitle()                       │
              │ (cliente)                                 │
              ▼                                           ▼
   ┌──────────────────────┐                  ┌──────────────────────┐
   │ POST                 │                  │ POST                 │
   │ publish-track-meta   │                  │ publish-stream-url   │
   │ Edge Function        │                  │ Edge Function        │
   │ - auth.getUser       │                  │ - auth.getUser       │
   │ - rate-limit 100/min │                  │ - rate-limit 200/min │
   │ - cleanYoutubeTitle  │                  │ - validar TTL        │
   │   (defensa)          │                  │                      │
   └──────────┬───────────┘                  └──────────┬───────────┘
              │ first-write-wins                        │ UPSERT
              ▼                                          ▼
   ┌──────────────────────┐                  ┌──────────────────────┐
   │   tracks_global      │                  │  stream_url_cache    │
   │   (Fase 2)           │                  │  (Fase 1)            │
   │   RLS any auth read  │                  │  RLS any auth read   │
   │   pg_cron: NO        │                  │  pg_cron: prune hr   │
   └──────────┬───────────┘                  └──────────┬───────────┘
              │                                          │
              │                                          │
              │       ┌──────────────────────┐           │
              │       │  Usuario2 busca o    │           │
              │       │  reproduce el mismo  │           │
              │       │  track               │           │
              │       └──────────┬───────────┘           │
              │                  │                       │
              │ READ             │                       │ READ
              ▼                  ▼                       ▼
   ┌──────────────────────┐                  ┌──────────────────────┐
   │ search-youtube       │                  │ get-stream-url       │
   │ paso 0: known lookup │                  │ via audio-source     │
   │ devuelve known[]     │                  │ paso 3 del cascade   │
   └──────────┬───────────┘                  └──────────┬───────────┘
              │                                          │
              ▼                                          ▼
   ┌──────────────────────┐                  ┌──────────────────────┐
   │ SearchView renderiza │                  │ backend.load(url)    │
   │ "✨ Conocidas en      │                  │ HIT cross-user       │
   │ Ritmiq" sobre        │                  │ Latencia 80-200ms vs │
   │ resultados YouTube   │                  │ 1-3s de yt-dlp       │
   └──────────────────────┘                  └──────────────────────┘
```

## Privacidad

| Aspecto | Política |
|---|---|
| `user_id` en filas cross-user | **NO** (en stream_url_cache ni tracks_global) |
| IP, device_id, location | **NO** |
| Timestamps minuto/segundo | `first_seen_at`/`updated_at` con granularidad seg (OK) |
| `contribution_count` agregado | Sí — anónimo, no individual-identificable |
| `unique_listeners` per-track | **NO** (riesgo de deanonimización en base pequeña) |
| Trending temporal | **NO** aún (mismo motivo) |

## Telemetría observable al usuario

`Settings → Diagnóstico`:
- **Diccionario global Ritmiq:** N canciones canonizadas (live count + mis contribuciones)
- **Orígenes de stream (esta sesión):** breakdown por fuente, con `cache-global-url` resaltado

`Settings → Reproducción`:
- **Compartir resoluciones con la red Ritmiq** (toggle Fase 1)
- Panel con `intentos / éxitos / fallos / sesión` + botón "Probar conexión" + "Vaciar caché local"

## Cross-references

- [[stream_url_cache]] — tabla Fase 1
- [[tracks_global]] — tabla Fase 2
- [[publish-stream-url]] — Edge writer Fase 1
- [[get-stream-url]] — Edge reader Fase 1
- [[publish-track-meta]] — Edge writer Fase 2
- [[search-youtube]] — Edge reader Fase 2 (paso 0)
- [[clean-track-meta]] — utility canónica de cleaning
- [[audio-source]] — cascade de reproducción
