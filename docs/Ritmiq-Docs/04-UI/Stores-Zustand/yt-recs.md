---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-29
archivo: packages/ui/src/stores/yt-recs.js
tags: [store, zustand, recomendaciones, youtube]
---

# `yt-recs` (store)

> Store Zustand que llama a la edge [[yt-recs]] con un seedYtId y cachea los resultados en memoria por sesión. Convierte el payload en Tracks reproducibles.

## Ubicación
`packages/ui/src/stores/yt-recs.js`

## Estado / Slice
```js
{
  entries: {},  // Record<seedYtId, { loading?, error?, tracks? }>
  fetch(seedYtId),
  reset(),
}
```

## Anatomía del código (snippets comentados)

### Idempotencia + cache en memoria
`packages/ui/src/stores/yt-recs.js:75-81`

```js
const cur = get().entries[key];
if (cur?.tracks?.length) return cur;   // ya resuelto
if (cur?.loading) return cur;          // en vuelo
set((s) => ({ entries: { ...s.entries, [key]: { loading: true } } }));
```

**Por qué**: evita doble fetch del mismo seed. El cache de sesión complementa el cache server-side de 6h de la edge.

### Mapeo a Track reproducible
`packages/ui/src/stores/yt-recs.js:49-65`

```js
function ytTrackToTrack(t) {
  return { id: `yt:${t.ytId}`, source: 'youtube', ytId: t.ytId,
    title: t.title, artist: t.artist ?? null,
    coverUrl: t.thumbnail ?? null, durationSeconds: t.duration ?? null,
    reason: 'YouTube relacionado', /* ... */ };
}
```

**Por qué**: la edge devuelve un shape compacto; el player espera el shape Track completo.

### Retry
`packages/ui/src/stores/yt-recs.js:43-46`

```js
const callYtRecs = (seedYtId) => withRetry(() => callYtRecsRaw(seedYtId), { maxAttempts: 2 });
```

Usa [[with-retry]] con 2 intentos (la edge ya cachea, no hace falta más).

## Dependencias salientes
- [[yt-recs|edge yt-recs]], [[with-retry]], [[supabase]].

## Dependencias entrantes
- [[Home]] (combina con Last.fm via [[hybrid-scoring]]).

## Casos de borde y gotchas
- **Error → tracks: []**: nunca rompe el Home; degrada a fila vacía.
- **`reason` fijo**: todos los tracks llevan `'YouTube relacionado'`.

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Cambiar el shape de `ytTrackToTrack` | El player recibe Track inválido → cover/duración rotos. |

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 6.1).
