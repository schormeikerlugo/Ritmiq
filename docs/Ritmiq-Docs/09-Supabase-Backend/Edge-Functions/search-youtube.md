---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/search-youtube/index.ts
tags: [edge, youtube, innertube, busqueda, multi-tipo]
---

# `search-youtube`

> Búsqueda en YouTube vía la API interna Innertube. Soporta búsqueda por tipo (videos / channels / playlists) o multi-tipo (5 de cada).

## Ubicación
`supabase/functions/search-youtube/index.ts:1` (216 líneas)

## Endpoints

```
GET /search-youtube?q=<query>&max=12              → solo videos (compat)
GET /search-youtube?q=<query>&type=videos&max=20  → solo videos
GET /search-youtube?q=<query>&type=channels       → solo canales/artistas
GET /search-youtube?q=<query>&type=playlists      → solo playlists
GET /search-youtube?q=<query>&type=all            → 5 de cada tipo
```

## Códigos `params` de Innertube

```js
TYPE_PARAMS = {
  videos:    'EgIQAQ%3D%3D',
  channels:  'EgIQAg%3D%3D',
  playlists: 'EgIQAw%3D%3D',
};
```

Códigos URL-encoded del web client de YouTube. Estables hace varios años.

## Respuesta

- Tipo único: `{ items: [...] }`
- `type=all`: `{ videos: [...], channels: [...], playlists: [...] }`

### Tipos de item

```ts
VideoItem    = { id, title, uploader, duration, thumbnail }
ChannelItem  = { id (channelId), title, subscribers, thumbnail }
PlaylistItem = { id (playlistId), title, videoCount, thumbnail, author }
```

## Invocado desde
- [[api|ui/lib/api]] → `ytSearch`, `ytSearchAll`, `ytSearchByType`.
- [[search]] store → `fetch`, `fetchMore`.

## Por qué Innertube y no la YouTube Data API v3

- Innertube es la API interna que usan los clientes oficiales. **No requiere API key del usuario** (la app trae una pública embebida).
- La Data API v3 cuesta cuota ($) por request y tiene límite diario.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Cambiar `clientVersion` a uno muy viejo | YouTube responde con datos incompletos o errores. |
| Quitar `User-Agent` realista | YouTube devuelve 400 o resultados raros. |

## Notas / Changelog
- 2026-05-22: nivel medio.
