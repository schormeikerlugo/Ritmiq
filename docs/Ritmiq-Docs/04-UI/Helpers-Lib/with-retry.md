---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/lib/with-retry.js
tags: [retry, network, edge-function, resilience]
---

# `with-retry`

> Wrapper genérico para promesas con retry exponencial + jitter. Pensado para fetchers que dependen de APIs externas (Last.fm, Innertube, lrclib) con tasa de error transitoria.

## Ubicación
`packages/ui/src/lib/with-retry.js:1` (123 líneas)

## Por qué existe

Ver [[Decisiones-Tecnicas-ADR|ADR-011]]. Antes cada store edge fallaba al primer 5xx/429 aunque el problema fuera transitorio. El usuario veía `ErrorState` para errores que se resolvían en el siguiente intento.

## API

```js
import { withRetry, defaultIsRetriable } from './with-retry.js';

const data = await withRetry(() => fetch(url), {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  isRetriable: defaultIsRetriable,
  onRetry: (attempt, err, delayMs) => console.info(`retry ${attempt} en ${delayMs}ms`),
  signal: abortController.signal,
});
```

## Defaults

| Param | Valor |
|---|---|
| `maxAttempts` | 3 |
| `baseDelayMs` | 500 |
| `maxDelayMs` | 8000 |
| `JITTER_FACTOR` | 0.2 (±20%) |
| `isRetriable` | `defaultIsRetriable` |

## Backoff exponencial con jitter

```js
const exp = Math.min(maxMs, baseMs * Math.pow(2, attemptIndex));
const jitter = exp * 0.2 * (Math.random() * 2 - 1);
delay = Math.max(0, Math.floor(exp + jitter));
```

Secuencia típica con defaults: ~500ms → ~1s → ~2s. El jitter evita que múltiples clientes reintenten al unísono y estampedeen al server.

## Clasificación de errores

`defaultIsRetriable(err)` devuelve `true` si:

- `err.name === 'TypeError'` (fetch network failure).
- `err.status` o `err.response.status` ∈ `{408, 429}` o ∈ `[500, 600)`.
- `err.message` matchea regex `/\b(5\d{2}|408|429)\b/`.
- `err.message` matchea regex `/network|fetch|timeout/i`.

Devuelve `false` si:

- `err.name === 'AbortError'` (cancelación explícita).
- Cualquier 4xx que no sea 408/429.
- Errores de parseo o sintaxis.

Se puede pasar `isRetriable` custom para criterios específicos.

## Cancellation con AbortSignal

El sleep entre reintentos respeta `signal.aborted`:

```js
await withRetry(fn, { signal });
// si abortController.abort() en mitad del backoff → throw AbortError
```

## Dónde se usa

| Caller | Endpoint |
|---|---|
| [[recommendations|stores/recommendations.js]] | Edge `recommendations` |
| [[artist|stores/artist.js]] | Edge `artist-detail` + `album-resolve` |
| [[yt-playlist|stores/yt-playlist.js]] | Edge `yt-playlist-resolve` |
| [[lyrics|stores/lyrics.js]] | Edge `lyrics` |

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Mover a `isRetriable` async | Cambiar todos los callers; preferir wrapping en el caller |
| Subir `maxAttempts` default a 5 | Más latencia perceptible en errores no-transitorios |
| Quitar jitter | Riesgo de estampede sincronizada si N clientes reintentan a la vez |
| Quitar AbortSignal | Componentes que se desmontan no podrán cancelar fetches activos |

## Casos de borde

- **fn no es async**: se envuelve en `Promise.resolve(fn())` implícitamente por el `await`.
- **fn resuelve con un valor falsy**: se retorna tal cual; no se reintenta.
- **maxAttempts = 1**: no reintenta; se comporta como `await fn()` con la única diferencia del try/catch.
- **Sin red durante TODO el ciclo**: tras `maxAttempts` se lanza el último error original.

## Changelog

- 2026-05-27 — Creada con la intro de [[Decisiones-Tecnicas-ADR|ADR-011]] (Fase 3.2).
