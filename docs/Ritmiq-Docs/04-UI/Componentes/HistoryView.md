---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/HistoryView/HistoryView.jsx
tags: [componente, history, search, filtros, play-history]
---

# `<HistoryView>`

> Vista dedicada de `play_history` con search + 3 filtros componibles (date range, artist filter, query string). Accesible desde un botón en el header de [[StatsView]].

## Ubicación
`packages/ui/src/components/HistoryView/HistoryView.jsx:1` (~200 líneas)

## Props

Sin props. Lee `events` del store [[history]].

## Stores consumidos

| Fuente | Uso |
|---|---|
| [[history]] store | `events` |
| [[player]] store | `playNow(tracks, idx)` |

## Filtros

| Filtro | Tipo | Opciones |
|---|---|---|
| **Search** | input substring | matchea `title` o `artist` (lowercase) |
| **Date range** | pill tabs | `all`, `today`, `week` (7d), `month` (30d), `year` (365d) |
| **Artist** | `<select>` | `all` + lista única de artistas presentes en events (ordenada alfabética) |

Los tres son componibles (AND lógico).

## Cómo se calcula `rangeStartMs`

```js
function rangeStartMs(rangeId) {
  const now = Date.now();
  switch (rangeId) {
    case 'today': /* setHours(0,0,0,0) → getTime */
    case 'week':  return now - 7 * 86400_000;
    case 'month': return now - 30 * 86400_000;
    case 'year':  return now - 365 * 86400_000;
    default:      return 0;  // sin filtro
  }
}
```

## Click en row

```js
const tracks = filtered.map(eventToTrack);
playNow(tracks, idx);
```

Carga el **filtered actual** como cola (no el historial completo). Si el usuario filtra por "Rock + última semana" y le da play al 3er resultado, los siguientes en la cola serán los demás de Rock de la última semana.

## `eventToTrack(event)`

Convierte un `HistoryEvent` a `Track`-like compatible con el player:

```js
{
  id: ev.trackId ?? (ev.ytId ? `yt:${ev.ytId}` : `hist:${ev.playedAt}`),
  source: ev.source ?? 'youtube',
  ytId: ev.ytId,
  title: ev.title,
  artist: ev.artist,
  durationSeconds: ev.durationSeconds,
  coverUrl: ev.coverUrl,
  ...
}
```

## `formatRelative(ts)`

| Edad | Formato |
|---|---|
| < 60s | `"ahora"` |
| < 1h | `"hace N min"` |
| < 1d | `"hace N h"` |
| < 7d | `"hace N d"` |
| ≥ 7d | fecha absoluta `"15 may"` (locale del usuario) |

## Cómo se llega

[[StatsView]] header → botón `Clock` "Ver historial completo" → `goHistory()` de [[view]] store.

## Empty states

- **Sin events en el store**: el `EmptyState` global no se muestra (events viene del último login + tracking real-time). El usuario va viendo events conforme reproduce.
- **Sin matches por filtros**: `<EmptyState icon="Search">` con mensaje contextual ("No encontramos nada para '...' en los últimos 7 días").

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Cambiar el shape de `HistoryEvent` | Hay que actualizar `eventToTrack` |
| Cambiar el id del kind `history` en [[view]] | Routeo en `App.jsx` rota |
| Quitar artistFilter por ser caro (recompute en cada render) | Pierde una feature; alternativa: memoizar |

## Casos de borde

- **`artist` null en events**: estos events no aparecen en `artistOptions`. Cuando `artistFilter === 'all'` sí se incluyen.
- **Eventos con timestamps inválidos**: `Number.isFinite(t)` los descarta del filtro de fecha.
- **Search con regex chars** (`.`, `*`): el código hace `includes` (substring), no regex; safe.

## Sub-componentes

- [[CoverArt]] (44×44 en rows)
- [[EmptyState]] de primitives
- [[Icon]]

## Changelog

- 2026-05-27 — Creada en Fase 4.9. Commit `9ca428e`.
