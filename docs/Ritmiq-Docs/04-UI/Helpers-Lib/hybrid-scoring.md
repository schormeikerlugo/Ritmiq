---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-29
archivo: packages/ui/src/lib/hybrid-scoring.js
tags: [helper, recomendaciones, scoring, hybrid]
---

# `hybrid-scoring`

> Combina recomendaciones de múltiples fuentes (Last.fm, YouTube, Spotify) en una lista única con scoring híbrido y consensus boost. Tracks que coinciden en 2+ fuentes suben al top.

## Ubicación
`packages/ui/src/lib/hybrid-scoring.js`

## Exports
| Export | Firma | Uso |
|---|---|---|
| `combineSources(sources, opts)` | `({source, tracks}[], {limit?}) → track[]` | Merge de N fuentes. |
| `combineTwoSources(sA, tA, sB, tB, opts)` | wrapper de 2 fuentes | Conveniencia. |

## Pesos por fuente
```js
const SOURCE_WEIGHTS = { lastfm: 1.0, yt: 0.85, spotify: 1.1 };
const CONSENSUS_BOOST_PER_EXTRA_SOURCE = 0.5;
```
- `lastfm` 1.0: calidad consistente, buena diversidad.
- `yt` 0.85: más variedad pero ruido en el campo artist.
- `spotify` 1.1: **reservado** (mejor calidad cuando se active OAuth — ver [[Activar-Spotify-OAuth]]).

## Anatomía del código (snippets comentados)

### Score por posición
`packages/ui/src/lib/hybrid-scoring.js:44-47`

```js
// Score por posicion: el primer track vale 1.0, el ultimo vale 0.
const posScore = n === 1 ? 1 : 1 - (i / (n - 1));
const score = posScore * weight;
```

**Por qué**: cada fuente entrega tracks ya ordenados por relevancia. Convertimos la posición en un score normalizado [0,1] y lo escalamos por el peso de la fuente.

### Consensus boost
`packages/ui/src/lib/hybrid-scoring.js:77-80`

```js
for (const entry of merged.values()) {
  if (entry.sources.size > 1) {
    entry.score += CONSENSUS_BOOST_PER_EXTRA_SOURCE * (entry.sources.size - 1);
  }
}
```

**Por qué**: si dos (o tres) fuentes independientes coinciden en un track, es señal fuerte. +0.5 por fuente extra casi siempre lo mueve al top.

### Early-return de fuente única
`packages/ui/src/lib/hybrid-scoring.js:108-113`

```js
// Si solo hay una fuente, devolverla tal cual (sin recomputar score).
if (valid.length === 1) {
  const out = valid[0].tracks.filter((t) => t?.ytId).slice(0, opts.limit ?? Infinity);
  return out;
}
```

**Por qué**: con una sola fuente no hay nada que combinar; preservar el orden original evita ruido.

## Inputs / Outputs
- Input: `[{ source: 'lastfm', tracks: [...] }, ...]`. Dedup por `ytId`; tracks sin `ytId` se descartan (no reproducibles).
- Output: tracks ordenados desc por score, enriquecidos con `hybridScore` + `hybridSources` (útil para tooltip/debug).

## Dependencias entrantes
- [[Home]] (combina Last.fm + YouTube; Spotify se añadirá al activar).

## Casos de borde y gotchas
- **Sin `ytId` → descartado**: cualquier track no reproducible se filtra silenciosamente.
- **Fuentes vacías**: se filtran antes de combinar; si todas vacías → `[]`.

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Cambiar `SOURCE_WEIGHTS` | El orden del Home cambia; YouTube puede dominar si sube su peso. |
| Quitar el dedup por `ytId` | Tracks duplicados en el Home. |

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 6.2).
