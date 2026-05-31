---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
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
- 2026-05-27 (Fase 4.6): añadida sección [[ActivityHeatmap]] entre el grid de cards y la sección "Trofeos". Commit `289ce3d`.
- 2026-05-27 (Fase 4.9): añadido botón `Clock` "Ver historial completo" en el header → navega a [[HistoryView]] vía `goHistory()` del [[view]] store. Commit `9ca428e`.
- 2026-05-31 (**rediseño ambicioso**): reescritura completa de la UI.
  - **Hero**: eyebrow con punto accent, botón "Ver historial" alineado a la derecha en desktop (debajo en móvil), tildes corregidas en todo el texto.
  - **Bento de métricas**: la racha actual es ahora una `FeatureStreakCard` grande destacada (icono `Flame` con pulse, glow, mensaje contextual "¡Estás en tu mejor racha!" / "Tu récord: N días"). Las otras 6 métricas en un grid 3×2. **Acento sutil** (velo accent tenue) en lugar de borde duro `data-highlight`. **Contexto derivado**: sublabels "~N/día activo" y "~N min/día".
  - **Iconos corregidos**: racha → `Flame` (antes `AlertCircle`, semánticamente erróneo); récord → `Trophy`; días activos → `CalendarDays`; escuchadas → `Headphones`.
  - **Trofeos**: **barra de progreso** hacia cada hito bloqueado ("Faltan N días"), estado desbloqueado con `Check` + glow por tier. Iconos `Star`/`Trophy`/`Award` ahora visibles (se registraron en [[Icon]]).
  - **Tops**: usan [[CoverArt]] (gradient hash) en vez de `<Icon>` plano; **medallas** oro/plata/bronce para top 3.
  - **GSAP**: entrada con `stagger` vía [[use-view-transition]] (`childSelector` = `.animBlock`), re-anima al cambiar de periodo. Respeta `prefers-reduced-motion`.
  - Verificado con Playwright (chromium headless) a 1300px (desktop) y 390px (móvil).
  - Commit `feat(stats): rediseno StatsView con bento...`.
- 2026-05-31 (fix anim): el pulso de la llama de racha (`ritmiq-streak-pulse`) animaba
  `filter: drop-shadow` → se veía a tirones en Electron desktop. Migrado a un `::after` con
  el glow estático que anima solo `opacity` + `scale` (GPU). Ver [[Decisiones-Tecnicas-ADR|ADR-020]].
