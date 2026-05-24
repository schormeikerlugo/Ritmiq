---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-24
archivo: supabase/functions/search-youtube/index.ts
tags: [edge, youtube, innertube, busqueda, multi-tipo, p2p]
---

# `search-youtube`

> Búsqueda en YouTube vía la API interna Innertube. Soporta búsqueda por tipo (videos / channels / playlists) o multi-tipo (5 de cada). **Desde 2026-05-24** también consulta [[tracks_global]] en paralelo y devuelve `known[]` con tracks ya canonizados por la red Ritmiq.

## Ubicación
`supabase/functions/search-youtube/index.ts`

## Endpoints

```
GET /search-youtube?q=<query>&max=12              → solo videos (compat)
GET /search-youtube?q=<query>&type=videos&max=20  → solo videos + known
GET /search-youtube?q=<query>&type=channels       → solo canales/artistas
GET /search-youtube?q=<query>&type=playlists      → solo playlists
GET /search-youtube?q=<query>&type=all            → 5 de cada tipo + known
GET /search-youtube?q=<query>&known=0             → deshabilitar known lookup (debug)
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

- Tipo único: `{ items: [...], known: [...] }`
- `type=all`: `{ videos: [...], channels: [...], playlists: [...], known: [...] }`

### Tipos de item

```ts
VideoItem    = { id, title, uploader, duration, thumbnail }
ChannelItem  = { id (channelId), title, subscribers, thumbnail }
PlaylistItem = { id (playlistId), title, videoCount, thumbnail, author }
KnownItem    = { ytId, title, artist, album, coverUrl, durationSeconds, contributionCount }
```

## Paso 0: known lookup en tracks_global

Antes de pegarle a Innertube, lanza en PARALELO una query a [[tracks_global]]:

```sql
SELECT yt_id, title, artist, album, cover_url, duration_seconds, contribution_count
FROM tracks_global
WHERE title ILIKE '%palabra1%palabra2%...'
   OR artist ILIKE '%palabra1%palabra2%...'
ORDER BY contribution_count DESC
LIMIT 10;
```

Latencia: <50ms warm (Postgres con índices FTS). Como corre en paralelo con Innertube via `Promise.all`, no añade latencia al endpoint en el caso típico.

Tolerante a errores: si la tabla no existe o falla, retorna `known: []` y el flujo de Innertube sigue como antes.

## Cleaning aplicado (2026-05-24)

Tras `extractItems`, antes de devolver, cada video pasa por [[clean-track-meta]] `cleanYoutubeTitle({ rawTitle, rawUploader })`. Resultado:
- title sin `(Official Music Video)`, `[4K]`, `(Audio)`, etc.
- uploader con sufijos VEVO/TV/Topic strippeados.
- En caso de uploader genérico (VEVO, Records, sellos), split de `"Artist - Title"`.

## Invocado desde
- [[api|ui/lib/api]] → `ytSearch`, `ytSearchAll`, `ytSearchByType`.
- [[search]] store → `fetch`, `fetchMore`.
- `SearchView.jsx` consume `known[]` y renderiza franja "✨ Conocidas en Ritmiq" sobre los resultados de YouTube.

## Por qué Innertube y no la YouTube Data API v3

- Innertube es la API interna que usan los clientes oficiales. **No requiere API key del usuario** (la app trae una pública embebida).
- La Data API v3 cuesta cuota ($) por request y tiene límite diario.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Cambiar `clientVersion` a uno muy viejo | YouTube responde con datos incompletos o errores. |
| Quitar `User-Agent` realista | YouTube devuelve 400 o resultados raros. |

## Notas / Changelog
- 2026-05-24: añadido paso 0 (lookup en [[tracks_global]] retornando `known[]`) + cleaning canónico via [[clean-track-meta]] aplicado a videoRenderer.
- 2026-05-22: nivel medio.
