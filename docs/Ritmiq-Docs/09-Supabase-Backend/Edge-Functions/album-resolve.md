---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/album-resolve/index.ts
tags: [edge, lastfm, innertube, album, cache]
---

# `album-resolve`

> Resuelve un álbum (artista + nombre) a lista de tracks reproducibles con `ytId`. Cache 7 días en `album_resolve_cache`.

## Ubicación
`supabase/functions/album-resolve/index.ts:1` (235 líneas)

## Endpoint

```
GET /album-resolve?artist=<a>&album=<b>
Headers: Authorization: Bearer <user JWT>
```

## Respuesta

```ts
{
  artist: string,
  album: string,
  year: number | null,
  coverUrl: string,
  tracks: [{ title, ytId, thumbnail, duration }],
  generatedAt: string,
  cached: boolean,
}
```

## Pipeline

```
1. Cache lookup en album_resolve_cache (TTL 7 días, key = sha256(artist + album lowercase)).
2. Si miss:
   a) Last.fm album.getInfo → tracklist + coverArt + year.
   b) Para cada track: Innertube search "<artist> <title>" → primer hit.
   c) UPSERT en cache.
3. Return payload.
```

## Por qué TTL 7 días (más largo que artist-detail)

Los álbumes no cambian. Una vez resuelto, los `ytId` siguen válidos casi siempre. TTL largo reduce drástricamente las llamadas a Innertube.

## Invocado desde
- [[artist]] store → `resolveAlbum(artist, album)`.
- [[AlbumView]] componente.
- [[artist#saveAlbumAsPlaylist]] al guardar el álbum como playlist.

## Notas / Changelog
- 2026-05-22: nivel medio.
