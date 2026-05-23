---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/library-search.js
tags: [helper, busqueda, biblioteca, local, dedup]
---

# `lib/library-search.js`

> Búsqueda local-first sobre la biblioteca del usuario. AND-filter de tokens en `title + artist + album`, normalización NFD para diacríticos. Deduplicación de resultados YouTube contra tracks ya en biblioteca.

## Ubicación
`packages/ui/src/lib/library-search.js:1` (119 líneas)

## Exports

```js
function searchLibraryTracks(tracks: Track[], query: string, limit?: number = 5): Track[]
function dedupeByYtId(youtubeResults: {id:string}[], localTracks: Track[]): {id:string}[]
```

## `searchLibraryTracks`

- **AND semantics**: todos los tokens deben aparecer en el haystack.
- **NFD normalization**: "Café Tacvba" → "cafe tacvba" para que "cafe" y "café" coincidan.
- **Scoring simple**: prefijo del primer token en el título = +10 puntos → mejores resultados arriba.
- **Early exit**: para cuando tiene `limit * 4` resultados candidatos → no escanea 10K tracks si ya tiene 20 para mostrar 5.

## Por qué O(n) es aceptable

La biblioteca típica < 10K tracks. Un filtro O(n) por keystroke tarda ~1ms. Sin índice, sin worker, sin debounce necesario.

## `dedupeByYtId`

```js
const localYtIds = new Set(localTracks.map(t => t.ytId).filter(Boolean));
return youtubeResults.filter(r => !localYtIds.has(r.id));
```

Evita mostrar en "Resultados de YouTube" tracks que el usuario ya tiene en su biblioteca. Sin esto, el mismo track aparecería dos veces en el dropdown (una vez como "En tu biblioteca" y otra como resultado de YouTube).

## Tiene test

`packages/ui/src/lib/library-search.test.js` (142 líneas) — cubre normalización, AND semantics, scoring y dedup.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| OR en lugar de AND | Buscar "Arctic Monkeys" devuelve cualquier track que tenga "Arctic" O "Monkeys" → resultados irrelevantes. |
| Sin NFD normalization | "Café Tacvba" no aparece al buscar "cafe" → usuarios hispanohablantes con diacríticos frustrados. |

## Notas / Changelog
- 2026-05-22: nivel medio.
