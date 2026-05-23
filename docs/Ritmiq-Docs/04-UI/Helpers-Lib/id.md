---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/id.js
tags: [helper, uuid, utilitario]
---

# `lib/id.js`

> Genera UUIDs v4 usando `crypto.randomUUID` (nativo) con fallback de Math.random para entornos sin la API.

## Ubicación
`packages/ui/src/lib/id.js:1` (12 líneas)

## Export

```js
function randomId(): string   // UUID v4 formato xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
```

## Usado por
- [[import]] store → `randomId()` para IDs de nuevos tracks persistidos.
- [[playlists]] store → `randomId()` para nuevas playlists.
- [[api|ui/lib/api]] → `persistFromMeta`.
- [[sync-queue]] → `cryptoRandomId()` (réplica interna).

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Devolver timestamp sin UUID format | Postgres rechaza con `invalid input syntax for type uuid` en inserts. |

## Notas / Changelog
- 2026-05-22: nivel simple.
