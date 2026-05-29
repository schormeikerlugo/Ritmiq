---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-29
archivo: supabase/functions/yt-recs/index.ts
tags: [edge-function, recomendaciones, youtube, innertube, cache]
---

# `yt-recs`

> Recomendaciones basadas en la "watch next" autoplay queue de YouTube (Innertube). Fuente alternativa a [[recommendations]] (Last.fm), sin API key, mejor cobertura de catálogo latino/asiático y tracks recientes.

## Ubicación
`supabase/functions/yt-recs/index.ts`

## Endpoint
```
GET /yt-recs?seed=<ytId>
Headers: Authorization: Bearer <user JWT>, apikey: <anon>
```

## Inputs
| Nombre | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `seed` (query) | `string` | sí | ytId del track semilla. Validado contra `/^[A-Za-z0-9_-]{8,15}$/`. |
| `Authorization` | header | sí | JWT del usuario (se identifica para satisfacer la FK del cache). |

## Outputs / Retorno
```json
{
  "seed": "dQw4w9WgXcQ",
  "tracks": [{ "ytId": "...", "title": "...", "artist": "...", "thumbnail": "...", "duration": 213 }],
  "generatedAt": "2026-05-29T...",
  "cached": true
}
```
Máx 20 tracks (`MAX_TRACKS`).

## Anatomía del código (snippets comentados)

### Cache key independiente del usuario
`supabase/functions/yt-recs/index.ts:86-90`

```ts
// YouTube devuelve lo mismo para todos los anonimos, asi que el cache
// se comparte entre usuarios via cache_key = hash(seedYtId). El user_id
// solo se guarda para satisfacer la FK a auth.users en recommendation_cache.
const cacheKey = await sha256Hex(`yt-recs:${seedYtId}`);
```

**Por qué**: la fuente NO depende del usuario. Compartir cache entre users con el mismo seed reduce llamadas a Innertube. El `user_id` es solo formal (la tabla tiene FK).

### TTL 6h (más corto que recommendations)
`supabase/functions/yt-recs/index.ts:42`

```ts
const CACHE_TTL_MS = 6 * 3600_000; // 6h
```

**Por qué**: YouTube refresca su autoplay queue con frecuencia (engagement reciente). Last.fm es más estable → 12h en [[recommendations]].

## Dependencias salientes (qué usa)
- [[innertube]] (`ytNext` — endpoint `next` de Innertube).
- [[recommendation_cache]] (lectura/escritura via service role).

## Dependencias entrantes (quién la llama)
- [[yt-recs|store yt-recs]] (`callYtRecsRaw`).

## Side-effects
- Red: POST a `youtube.com/youtubei/v1/next` via [[innertube]].
- DB: upsert en `recommendation_cache` (kind `yt-recs`).

## Errores manejados
- `401` sin Authorization o user no resuelto.
- `400` seed inválido.
- `502` Innertube falla (`ytNext` throw).
- `404` sin tracks relacionados.
- Cache read/write fallan → `console.warn`, no aborta (degradación gradual).

## Casos de borde y gotchas
- **Artist ruidoso**: el `artist` viene de `shortBylineText` del canal YouTube. Canales "X - Topic" generan ruido, pero el `ytId` siempre es correcto y reproducible.
- **Seed filtrado**: `ytNext` excluye el propio seed de los resultados ([[innertube]] línea 103).

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Cambiar el path de parseo en `ytNext` | `tracks` vacío → 404 constante; el Home pierde la fila de YouTube recs. |
| Quitar el filtro de `seedYtId` en cache | Cache no se reutiliza entre users; más llamadas a Innertube. |

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 6).
