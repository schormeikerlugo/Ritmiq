---
tipo: modulo
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-29
archivo: supabase/functions/_shared/innertube.ts
tags: [edge-function, shared, youtube, innertube, helper]
---

# `_shared/innertube`

> Cliente compartido de la API Innertube de YouTube. Sin OAuth ni API key del usuario: usa la API key pública de la app WEB que YouTube usa internamente. Provee parsers de nodos + `ytNext` (watch-next queue).

## Ubicación
`supabase/functions/_shared/innertube.ts`

## Exports
| Export | Tipo | Uso |
|---|---|---|
| `INNERTUBE_KEY` | const | API key pública WEB. Estable hace años. |
| `INNERTUBE_BASE` | const | `https://www.youtube.com/youtubei/v1`. |
| `INNERTUBE_CONTEXT_WEB` | const | Context client WEB. |
| `INNERTUBE_CONTEXT_MUSIC` | const | Context WEB_REMIX (reservado, sin uso aún). |
| `nodeText(node)` | fn | Extrae texto de `{ runs }` o `{ simpleText }`. |
| `pickThumbnail(thumb)` | fn | Thumbnail más grande de un nodo. |
| `parseDurationText(text)` | fn | `"3:42"` / `"1:02:33"` → segundos. |
| `ytNext(videoId)` | async fn | Watch-next queue del video. |

## Firma principal
```ts
async function ytNext(videoId: string): Promise<Array<{
  ytId: string; title: string; artist: string | null;
  thumbnail: string | null; duration: number | null;
}>>
```

## Anatomía del código (snippets comentados)

### Path de parseo de la watch-next queue
`supabase/functions/_shared/innertube.ts:94-103`

```ts
const results = data?.contents?.twoColumnWatchNextResults
  ?.secondaryResults?.secondaryResults?.results ?? [];
for (const item of results) {
  const v = item?.compactVideoRenderer;
  if (!v?.videoId) continue;
  // Filtrar el video de seed: no tiene sentido recomendar el mismo.
  if (v.videoId === videoId) continue;
```

**Por qué**: Innertube devuelve un árbol JSON profundo y frágil. Este path es el que YouTube usa para los `compactVideoRenderer` de la columna secundaria. Si YouTube cambia el shape, este selector es lo primero que rompe.

## Dependencias entrantes (quién la llama)
- [[yt-recs]] (`ytNext`).
- [[recommendations]] (búsqueda — usa key/context).
- [[yt-playlist-resolve]] (browse — usa key/context).

## Side-effects
- Red: POST a `youtube.com/youtubei/v1/next`.

## Errores manejados
- `ytNext` throw `innertube next <status>` si la respuesta no es OK.

## Casos de borde y gotchas
- **API key estable pero no garantizada**: si YouTube la rota, todas las funciones que usan Innertube fallan a la vez. No hay fallback.
- **`WEB_REMIX` reservado**: `INNERTUBE_CONTEXT_MUSIC` existe para resultados más musicales (YouTube Music) pero no se usa; `ytNext` con WEB cubre el caso por ahora.

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| YouTube cambia el path de `secondaryResults` | `ytNext` devuelve `[]` → [[yt-recs]] 404. |
| API key revocada | Todas las edge functions Innertube fallan con error de red/403. |

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 6).
