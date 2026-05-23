---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/recommendations/index.ts
tags: [edge, lastfm, innertube, recomendaciones, cache]
---

# `recommendations`

> Recomendaciones musicales con Last.fm + Innertube. 4 kinds: `similar-artist`, `mix-by-track`, `genre-mix`, `discover`. Cache server-side en `recommendation_cache` (TTL 12h).

## Ubicación
`supabase/functions/recommendations/index.ts:1` (542 líneas — la más grande)

## Endpoint

```
GET /recommendations?kind=<kind>&seed=<seed>
Headers: Authorization: Bearer <user JWT>
```

## Kinds soportados

| Kind | Seed | Estrategia |
|---|---|---|
| `similar-artist` | nombre del artista | Last.fm `artist.getSimilar` → top tracks de cada uno |
| `mix-by-track` | `artist::title` | Last.fm `track.getSimilar` → tracks similares |
| `genre-mix` | tag (ej. "reggaeton") | Last.fm `tag.getTopTracks` |
| `discover` | (auto) | Artistas similares a tus top, **que NO están en tu biblioteca** |

## Pipeline

```
1. Buscar payload fresco (< 12h) en recommendation_cache → return.
2. Llamar Last.fm con el método correspondiente.
3. Para cada track candidato → Innertube search → obtener ytId reproducible.
4. UPSERT en recommendation_cache.
5. Return payload.
```

## Variables de entorno

| Variable | Descripción |
|---|---|
| `LASTFM_API_KEY` | API key gratuita de Last.fm |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Auto-inyectadas |

## Caché

Tabla `recommendation_cache` con TTL 12h. La clave de cache es `(user_id, kind, seed)`. Limpieza periódica via [[migrations#20260515]] cron.

## Invocado desde
- [[recommendations]] store → `fetch(kind, seed)`.
- [[Home]] componente — múltiples filas independientes.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Cache TTL 0 | Cada visita a Home llama a Last.fm + Innertube → quota agotada en horas. |
| Innertube sin User-Agent realista | YouTube bloquea → tracks sin ytId → fila vacía. |
| Sin filtro de duplicados en `discover` | Recomendaciones incluyen tracks ya en biblioteca. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
