---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/radio.js
tags: [helper, radio, biblioteca, algoritmo]
---

# `lib/radio.js`

> Algoritmo de Radio basado únicamente en la biblioteca local. No toca la red. Genera un batch de N tracks con reparto 60% artista-seed / 30% artistas co-escuchados / 10% descubrimiento.

## Ubicación
`packages/ui/src/lib/radio.js:1` (128 líneas)

## Export principal

```js
function buildRadioBatch({
  seedTrack: Track,
  batchSize?: number,      // default 15
  excludeIds?: Set<string> // tracks ya en la cola (evitar repeticiones)
}): Track[]
```

## Algoritmo

```
Bucket A (60%): tracks de la lib del artista seed
Bucket B (30%): tracks de la lib de los TOP-3 artistas co-escuchados
                (frecuentes en historial de 90 días junto al seed)
Bucket C (10%): tracks aleatorios (descubrimiento)
```

Si algún bucket está vacío, se rellena con tracks aleatorios de la lib para completar el batch.

## Anatomía del código (snippets clave)

### `findCoListenedArtists`: aproximación de "mismo género"
`packages/ui/src/lib/radio.js:52-74`

```js
// Cuenta plays por artista en los últimos 90 días, excluyendo el seed.
// Devuelve los top N ordenados por frecuencia.
const counts = new Map();
for (const ev of events) {
  const t = new Date(ev.playedAt ?? ev.createdAt ?? 0).getTime();
  if (!Number.isFinite(t) || t < since) continue;
  const a = norm(ev.artist);
  if (!a || a === seedNorm) continue;
  counts.set(a, (counts.get(a) ?? 0) + 1);
}
```

**Por qué esta aproximación**: sin columna `genre` en los tracks, usar co-ocurrencia en el historial como proxy de "mismo género". Si el usuario escucha Arctic Monkeys con The Strokes y The White Stripes, esos aparecerán juntos → radio coherente.

### Reparto y shuffle final
`packages/ui/src/lib/radio.js:107-127`

```js
const picks = [
  ...shuffle(sameArtist).slice(0, nA),
  ...shuffle(sameVibe).slice(0, nB),
  ...shuffle(discovery).slice(0, nC),
];
// Shuffle final para que el bucket A no salga todo seguido
return shuffle(picks).slice(0, batchSize);
```

**Por qué shuffle final**: sin él, los primeros `nA` tracks son siempre del artista seed → el radio suena como "loop del mismo artista" en los primeros tracks.

## Invocado por

- [[use-radio]] hook → `buildRadioBatch` cuando quedan ≤ 2 tracks por delante.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Quitar shuffle final | El radio empieza con N tracks del artista seed consecutivos → monótono. |
| Cambiar ventana de historial de 90 a 1 día | Co-listened artists casi siempre vacío → radio mayormente discovery aleatorio. |
| `batchSize = 0` | Array vacío → el hook no añade tracks → radio termina. |

## Notas / Changelog
- 2026-05-22: nivel medio.
