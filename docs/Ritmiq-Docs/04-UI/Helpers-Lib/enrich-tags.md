---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/lib/enrich-tags.js
tags: [helper, recommendations, lastfm, cache, fire-and-forget]
---

# `lib/enrich-tags`

> Cliente fire-and-forget para disparar la edge function [[enrich-tags]] con un batch de artistas. Throttle 60s en localStorage para no spammear si el caller se monta en effects frecuentes.

## Ubicación
`packages/ui/src/lib/enrich-tags.js:1` (~90 líneas)

## API

```js
import { enrichArtistTags } from '../../lib/enrich-tags.js';

// Fire-and-forget (default):
enrichArtistTags(['Bad Bunny', 'Rosalia', 'Bizarrap']);

// Con respuesta (rara vez necesario):
const result = await enrichArtistTags(artists, { await: true });
// result = { enriched, cached, fetched, failed } o null si throttled.

// Ignorar throttle (admin / debug):
enrichArtistTags(artists, { force: true });
```

## Throttle

| Clave localStorage | Vida |
|---|---|
| `ritmiq.enrich-tags-last-call` | timestamp del último call exitoso; 60s |

Si el caller llama dentro de 60s del último éxito → retorna `null` sin tocar la red. Único caller actual: [[Home]] en su `useEffect` que dispara las recs (Fase 5.2).

## Dedup + clamp en cliente

```js
const seen = new Set();
const clean = [];
for (const a of artists) {
  const k = a.trim().toLowerCase();
  if (seen.has(k)) continue;
  seen.add(k);
  clean.push(a.trim());
  if (clean.length >= MAX_PER_REQUEST) break; // 50
}
```

Evita roundtrip de payloads grandes que el server rechazaría.

## Por qué fire-and-forget

Los consumers de `artist_tags` (Home → `auto-genre-mix`) leen el cache on-demand vía [[recommendations]] edge function. No necesitan saber el resultado de `enrichArtistTags` — solo activarlo para que la siguiente lectura encuentre datos fresh.

## Errores silenciados

`enrichArtistTags` envuelve el fetch en try/catch y retorna `null` en error. **Diseño intencional**: si Last.fm está caído, el cache existente sigue sirviendo. El usuario no debe enterarse.

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Subir throttle a 1h | Cache nunca se refresca proactivamente; depende del cron |
| Bajar a 5s | Spam a la edge function si el Home se re-renderiza |
| Cambiar `MAX_PER_REQUEST` > 50 | Server lo trunca de todas formas |

## Changelog

- 2026-05-27 — Creado en Fase 5.1. Commit `894b44d`. Único caller: [[Home]] (Fase 5.2).
