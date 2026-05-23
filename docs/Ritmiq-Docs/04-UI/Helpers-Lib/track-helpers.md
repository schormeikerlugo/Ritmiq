---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/track-helpers.js
tags: [helper, track, efimero, utilitario]
---

# `lib/track-helpers.js`

> Helpers para distinguir tracks efímeros (resultados de búsqueda, `id = "yt:<ytId>"`) de tracks persistidos (UUID real). Convierte metadata de yt-dlp en Track reproducible.

## Ubicación
`packages/ui/src/lib/track-helpers.js:1` (44 líneas)

## Exports

```js
function isEphemeralId(id: string): boolean           // id.startsWith('yt:')
function isEphemeralTrack(t: Track): boolean          // wrapper de isEphemeralId
function metaToCandidate(meta): Track                 // metadata → Track efímero
```

## Convención de IDs efímeros

```
Efímero:    id = "yt:dQw4w9WgXcQ"   — no persiste en Supabase
Persistido: id = "a8f3c1b2-..."      — UUID en Supabase + SQLite
```

Cuando el usuario "guarda" un track efímero, [[library#persistEphemeral]] lo convierte en persistido asignando un UUID real.

## `metaToCandidate`

```js
function metaToCandidate(meta: {
  id: string,            // ytId
  title: string,
  uploader?: string|null,
  duration?: number|null,
  thumbnail?: string|null
}): Track
```

- `id = "yt:" + meta.id`
- `coverUrl = rewriteHost(meta.thumbnail)` → aplica rewrite de IP loopback.

## Usado por

- [[library]] store → `isEphemeralTrack` en `persistEphemeral`.
- [[history]] store → `isEphemeralId` para saber si el trackId es válido como UUID.
- [[use-player]] → `isEphemeralTrack` en `buildResolveDeps`.
- [[SearchView]], [[Home]] → `metaToCandidate` para armar tracks reproducibles desde búsqueda.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Cambiar el prefijo `yt:` a otro string | `isEphemeralId` deja de identificar efímeros → `persistEphemeral` los trata como persistidos y falla. |
| Quitar `rewriteHost` en `metaToCandidate` | Thumbnails con IP loopback no cargan en la PWA del móvil en dev LAN. |

## Notas / Changelog
- 2026-05-22: nivel simple.
