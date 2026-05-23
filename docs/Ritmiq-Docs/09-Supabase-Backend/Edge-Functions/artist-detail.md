---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/artist-detail/index.ts
tags: [edge, lastfm, innertube, artista, cache]
---

# `artist-detail`

> Detalle de artista para la página `/artist`. Combina Last.fm (bio, listeners, tags, top tracks, top albums) con Innertube (resolución de ytId para top tracks). Cache 24h.

## Ubicación
`supabase/functions/artist-detail/index.ts:1` (325 líneas)

## Endpoint

```
GET /artist-detail?name=<artista>
Headers: Authorization: Bearer <user JWT>
```

## Respuesta

```ts
{
  name: string,
  bio: string,
  image: string,
  tags: string[],
  listeners: number | null,
  topTracks: [{ title, ytId, thumbnail, duration, playcount }],
  albums:   [{ title, year, coverUrl, trackTitles: string[] }],
  generatedAt: string,
  cached: boolean,
}
```

## Constantes

| Constante | Valor |
|---|---|
| `CACHE_TTL_HOURS` | 24 |
| `MAX_TOP_TRACKS` | 12 |
| `MAX_ALBUMS` | 30 |

## Por qué los álbumes NO resuelven sus tracks aquí

Resolver los tracks de 30 álbumes via Innertube costaría ~30 × 12 = 360 llamadas. Eso satura quota. Los álbumes solo traen `trackTitles[]`. La resolución on-demand vive en [[album-resolve]] cuando el usuario clickea un álbum.

## Cache

Tabla `artist_detail_cache` (clave: nombre del artista normalizado). TTL 24h.

## Invocado desde
- [[artist]] store → `fetch(name)`.
- [[ArtistView]] componente.

## Notas / Changelog
- 2026-05-22: nivel medio.
