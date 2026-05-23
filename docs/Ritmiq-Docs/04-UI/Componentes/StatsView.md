---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/StatsView/StatsView.jsx
tags: [componente, estadisticas, historial, streak, top-tracks]
---

# `StatsView`

> "Tu mes en Ritmiq" — estadísticas personales calculadas 100% client-side desde el historial en memoria. Selector de período (semana / mes / 3 meses / año). Sin red.

## Ubicación
`packages/ui/src/components/StatsView/StatsView.jsx:1` (409 líneas)

## Props
Sin props.

## Stores consumidos

| Store | Uso |
|---|---|
| [[history]] store | `events`, `selectStatsForPeriod` |
| [[player]] store | `playNow` (click en top track) |
| [[view]] store | `goBack` |

## Períodos disponibles
`7`, `30` (default), `90`, `365` días.

## Datos mostrados (`selectStatsForPeriod`)

| Dato | Descripción |
|---|---|
| `totalPlays` | Reproducciones en el período |
| `totalMinutes` | Minutos escuchados |
| `uniqueTracks` | Tracks distintos |
| `uniqueArtists` | Artistas distintos |
| `activeDays` | Días con al menos 1 play |
| `streak` | Racha de días consecutivos |
| `topTracks[5]` | Top 5 tracks por plays |
| `topArtists[5]` | Top 5 artistas por plays |

## Cálculo de racha

```js
for (let i = 0; i < days; i++) {
  const day = today - i * 86400_000;
  if (dayMap.has(day)) streak++;
  else if (i > 0) break;  // no interrumpir si hoy no hay plays aún
}
```

Sin red, sin llamada a backend. Todo del historial en `events[]`.

## Notas / Changelog
- 2026-05-22: nivel medio.
