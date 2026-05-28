---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-27
archivo: supabase/functions/yt-playlist-resolve/index.ts
tags: [edge, innertube, youtube, playlist]
---

# `yt-playlist-resolve`

> Resuelve una playlist pública de YouTube vía Innertube `browse?browseId=VL<id>`. Devuelve metadata (título, autor, cover) + array de tracks reproducibles. **Sin cache server-side** (cliente cachea en memoria por sesión).

## Ubicación
`supabase/functions/yt-playlist-resolve/index.ts:1` (~250 líneas)

## Endpoint

```
GET /yt-playlist-resolve?id=<playlistId>
Headers: Authorization: Bearer <user JWT>
```

`id` puede venir con o sin prefijo `VL`; el endpoint normaliza a `VL${id}` internamente.

## Respuesta

```ts
{
  id: string,
  title: string,
  author: string | null,
  coverUrl: string | null,
  tracks: Array<{
    ytId: string,
    title: string,
    artist: string | null,        // de shortBylineText (canal del video)
    thumbnail: string | null,
    duration: number | null,      // segundos
  }>,
  generatedAt: string,
}
```

## Pipeline

```mermaid
sequenceDiagram
  participant C as Cliente (stores/yt-playlist.js)
  participant E as Edge yt-playlist-resolve
  participant IT as Innertube

  C->>E: GET /yt-playlist-resolve?id=PLxxx
  E->>E: validar Authorization (anti-abuso)
  E->>IT: POST /youtubei/v1/browse?key=... { browseId:"VLPLxxx" }
  alt 200 con contents
    IT-->>E: tabs[0].sectionListRenderer.contents...
    E->>E: extractTracks() via playlistVideoRenderer
    E->>E: extractMetadata() via playlistSidebarRenderer
    E-->>C: { id, title, author, coverUrl, tracks }
  else 404 / playlist privada
    IT-->>E: 404 o sin tracks
    E-->>C: 404 { error: 'playlist sin tracks reproducibles' }
  else 5xx
    IT-->>E: 5xx
    E-->>C: 502
  end
```

## Constantes

| Constante | Valor |
|---|---|
| `INNERTUBE_URL` | `https://www.youtube.com/youtubei/v1/browse?prettyPrint=false` |
| `INNERTUBE_KEY` | `AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8` (clave WEB pública) |
| `clientName` | `'WEB'` |
| `clientVersion` | `'2.20240101.00.00'` |

## Extracción de tracks

```ts
data.contents.twoColumnBrowseResultsRenderer.tabs[0]
    .tabRenderer.content.sectionListRenderer.contents[0]
    .itemSectionRenderer.contents[0]
    .playlistVideoListRenderer.contents[].playlistVideoRenderer
```

Para cada `playlistVideoRenderer`:

- `videoId` → `ytId`
- `title.runs[].text` → título
- `shortBylineText.runs[].text` → artista (canal)
- `thumbnail.thumbnails[max width]` → cover
- `lengthSeconds` o `lengthText` → duration

## Por qué no cachea

Las playlists YT del search son **menos frecuentes** que los álbumes (que sí cachean en `album_resolve_cache`). Si en producción se convierte en hot path, crear tabla `yt_playlist_cache` con TTL 24h.

Ver [[Decisiones-Tecnicas-ADR|ADR-N/A: Fase 0.5]] para el razonamiento completo.

## Qué puede romper este cambio

| Cambio | Impacto |
|---|---|
| YouTube cambia los nombres internos de los renderers | Hay que actualizar todos los selectores; síntoma: tracks vacíos |
| INNERTUBE_KEY rotada | YouTube responde 403; muy improbable (clave pública WEB) |
| YouTube añade un `consentRequired` para anonymous | Hay que mandar `User-Agent` realista o cookies |
| Innertube cambia el formato de `lengthSeconds` a string vs number | parseInt defensivo ya cubre ambos |

## Casos de borde

- **Playlist privada o eliminada**: 404 con `tracks: []` filtrados → respuesta 404 al cliente.
- **Mix automático de YouTube** (RD playlists): no funcionan con `browseId=VL` — se ignoran. Los identifica `id.startsWith('RD')`; la función no los filtra a priori (devuelve 404 normal).
- **Playlists muy largas (>200 tracks)**: Innertube paginarea con `continuations`. La V1 **no** maneja continuations → devuelve la primera página (~100 tracks). Implementar `fetchContinuations` si se vuelve necesario.

## Variables de entorno

Ninguna específica. Usa `SUPABASE_URL` solo para el create client (no requerido para esta función).

## Deploy

```bash
supabase functions deploy yt-playlist-resolve --project-ref <ref>
```

## Changelog

- 2026-05-27 — Creada en Fase 0.5. Commit `d585e68`. Deployada vía Management API el mismo día.
