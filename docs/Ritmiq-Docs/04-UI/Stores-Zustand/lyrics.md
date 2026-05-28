---
tipo: store
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/stores/lyrics.js
tags: [store, lyrics, lrclib, cache, edge-function]
---

# `stores/lyrics.js`

> Store de letras (lyrics) por track. Llama a la Edge Function [[lyrics]] que proxy-ea lrclib.net + cache server-side. Cache cliente en memoria con `parseLrc()` interno para convertir LRC sincronizado a `[{ timeMs, text }]`.

## Ubicación
`packages/ui/src/stores/lyrics.js:1` (152 líneas)

## Estado

```js
{
  entries: Record<string, {
    loading?: boolean,
    found?: boolean,
    synced?: string | null,    // raw LRC string del server
    plain?: string | null,
    instrumental?: boolean,
    parsed?: Array<{ timeMs: number, text: string }>,  // post-parseLrc
    error?: string,
  }>
}
```

Clave compuesta `${artist}::${title}::${durationBucket5s}` — duration en bucket de 5s para tolerar pequeños drifts entre fuentes.

## Acciones

### `fetch({ artist, title, duration? })`

- Idempotente: si ya hay `entry` (loading o resuelta), devuelve la existente sin disparar fetch.
- Envuelve `callLyricsRaw` con [[with-retry]] (`maxAttempts: 2` — lrclib es relativamente estable, no justifica 3 intentos).
- Al recibir payload con `synced`, ejecuta `parseLrc()` para producir `parsed`.

### `get({ artist, title, duration? })`

Lookup síncrono sin disparar fetch. Útil para componentes que ya saben que el fetch lo hizo otro.

### `reset()`

Limpia `entries` (logout, switch de cuenta).

## `parseLrc(synced)`

Convierte string LRC del estilo:

```
[00:12.34]Some line
[00:12.34][00:45.10]Repeated chorus
[00:12]Sin centisegundos
```

…a:

```js
[
  { timeMs: 12340, text: 'Some line' },
  { timeMs: 12340, text: 'Repeated chorus' },
  { timeMs: 45100, text: 'Repeated chorus' },
  { timeMs: 12000, text: 'Sin centisegundos' },
]
```

Filtra metadata `[ti:Title]`, `[ar:Artist]` (no son timestamps). Ordena por `timeMs` ascendente.

## Pipeline completo

1. [[LyricsPanel]] llama `useLyricsStore.getState().fetch({ artist, title, duration })` al montar.
2. Si hay entry → render inmediato.
3. Si no, fetch a Edge Function [[lyrics]] (proxy a lrclib.net con cache 30d en [[lyrics_cache]]).
4. Servidor responde JSON con `synced`/`plain`/`instrumental`/`found`.
5. Cliente parsea `synced` con `parseLrc()` → guarda `parsed` en el entry.

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Cambiar bucket de duración (5s → 10s) | Invalidación del cache server-side hasta TTL |
| Mover parseLrc al servidor | Menos lógica cliente pero más payload — actual ~3 KB de synced vs ~1 KB parseado |
| Quitar withRetry | Errores 5xx de lrclib visibles para el user |

## Casos de borde

- **`title` vacío o `artist` vacío**: retorna `null` sin fetch.
- **Track instrumental**: `found:true`, `synced:null`, `plain:null`, `instrumental:true`. [[LyricsPanel]] muestra badge "Instrumental".
- **lrclib no encuentra**: `found:false`. El edge function igual cachea con TTL corto (7d) para no martillar.
- **LRC malformado** (timestamps inválidos): `parseLrc()` los descarta silenciosamente; quedan menos líneas.

## Changelog

- 2026-05-27 — Creado en Fase 4.1. Commit `1375f40`.
