---
tipo: store
capa: ui
plataforma: ambas
estado: beta
ultima-revision: 2026-05-22
archivo: packages/ui/src/stores/recommendations.js
tags: [store, recomendaciones, lastfm, edge-function]
---

# `stores/recommendations.js`

> Store de recomendaciones (Fase 2 — Last.fm vía Edge Function). Mantiene un mapa de secciones `{ kind:seed → { tracks, loading, error } }` para las 4 filas de la Home.

## Ubicación
`packages/ui/src/stores/recommendations.js:1` (91 líneas)

## Estado

```js
{
  sections: Record<`${kind}:${seed}`, {
    tracks: TrackLike[],
    generatedAt?: string,
    loading: boolean,
    error: string | null,
  }>
}
```

Clave compuesta `${kind}:${seed}` permite tener múltiples filas independientes en la Home.

## Tipos de `kind`

| kind | Descripción |
|---|---|
| `'similar-artist'` | Artistas similares al más escuchado (Last.fm similar artists) |
| `'mix-by-track'` | Tracks similares al último reproducido |
| `'genre-mix'` | Top tracks del género más frecuente del usuario |
| `'discover'` | Artistas nuevos fuera de la biblioteca |

## Acciones

### `fetch(kind, seed?)`

- Cache de sesión: si la sección ya tiene tracks → retorna sin fetch.
- Si está `loading` → retorna el estado actual sin duplicar request.
- Llama directamente a la Edge Function [[recommendations]] vía `fetch` con Bearer token.
- Los tracks del servidor se normalizan con `recToTrack()` a objetos `Track`-like reproducibles.

### `reset()`

Limpia todas las secciones. Llamar al sign-out.

## Anatomía del código (snippet clave)

### `recToTrack`: IDs efímeros para reproducir sin persistir
`packages/ui/src/stores/recommendations.js:40-56`

```js
function recToTrack(rec) {
  return {
    id: `yt:${rec.ytId}`,   // ID efímero — no es un UUID real
    userId: '',
    source: 'youtube',
    ytId: rec.ytId,
    title: rec.title,
    artist: rec.artist ?? null,
    durationSeconds: rec.duration ?? null,
    coverUrl: rec.thumbnail ?? null,
    filePath: null,
    isDownloaded: false,
    createdAt: new Date().toISOString(),
    reason: rec.reason ?? null,  // campo extra no en el tipo Track estándar
  };
}
```

**Por qué `id: yt:<ytId>`**: los tracks de recomendaciones no están en la biblioteca del usuario. Se reproducen como tracks efímeros. El `reason` extra (p.ej. `"Similar a Arctic Monkeys"`) se usa para mostrar el subtítulo de la fila en la Home.

## Casos de borde

- **Sin sesión**: `callRecs` tira `'sin sesión'`. La sección queda con `error`.
- **Servidor caído / quota Last.fm agotada**: la Edge Function devuelve error → sección con `error`. La Home no muestra la fila.
- **`seed` undefined**: `key = 'similar-artist:'`. Funciona, pero puede colisionar si dos filas del mismo `kind` tienen seed undefined. Nunca debe pasar en la práctica.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| `id: rec.ytId` sin prefijo `yt:` | `isEphemeralId` no lo detecta como efímero → `persistEphemeral` no lo procesa correctamente. |
| `cache de sesión` → re-fetch siempre | Quota de Edge Function se agota con visitas repetidas a Home. |
| `reset()` no llamado en logout | Recomendaciones del usuario anterior visibles al siguiente que hace login. |

## Notas / Changelog
- 2026-05-22: nivel simple. Estado `beta` por depender de Last.fm que puede tener downtime.
