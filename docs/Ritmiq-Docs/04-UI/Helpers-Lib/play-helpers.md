---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/play-helpers.js
tags: [helper, player, play, playlist, artista]
---

# `lib/play-helpers.js`

> Helpers imperativos para "reproducir desde cualquier sitio" — botones flotantes de play en cards de Library, Sidebar, Home, Artist y Album. Centraliza la resolución de playlist/artista → tracks → `playNow`.

## Ubicación
`packages/ui/src/lib/play-helpers.js:1` (55 líneas)

## Exports

```js
function playPlaylist(playlistId: string): boolean
function playArtistFromLibrary(artistName: string): boolean
// Devuelven true si arrancó reproducción, false si no hay tracks
```

## Por qué como helpers y no en el store

Estos helpers leen de múltiples stores ([[playlists]], [[library]], [[player]]) para resolver un track list. Poner esta lógica en un componente la duplicaría N veces. Ponerla en un store crearía acoplamiento entre stores.

## `playPlaylist(playlistId)`

```js
const ids = contents[playlistId] ?? [];
const byId = new Map(allTracks.map((t) => [t.id, t]));
const tracks = ids.map((id) => byId.get(id)).filter(Boolean);
usePlayerStore.getState().playNow(tracks, 0);
```

Resuelve el orden del `contents[id]` (array de trackIds en posición) y mapea al objeto Track completo de la biblioteca.

## `playArtistFromLibrary(artistName)`

Solo reproduce tracks ya en la biblioteca del usuario. Normalización case-insensitive. Para "play artista más completo" (incluyendo tracks de YouTube no en biblioteca) → usar la vista de artista directamente.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Ordenar por `createdAt` en lugar de `contents[id]` | La playlist ignora el orden de posición del usuario. |
| Case-sensitive en `playArtistFromLibrary` | "Arctic Monkeys" vs "arctic monkeys" da resultados distintos. |

## Notas / Changelog
- 2026-05-22: nivel simple.
