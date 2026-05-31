---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/Icon/Icon.jsx
tags: [componente, icon, lucide, svg]
---

# `Icon` + `SpotifyIcon`

> Componente wrapper de íconos Lucide React. Tamaño y color configurables via props.

## Ubicación
`packages/ui/src/components/Icon/Icon.jsx:1` (109 líneas)
`packages/ui/src/components/Icon/SpotifyIcon.jsx`

## Props

```js
// Icon
{
  name: string,           // nombre del ícono de Lucide (ej. "Play", "Heart")
  size?: number,          // default 24
  filled?: boolean,       // variante rellena (solid) si el ícono la tiene
  className?: string,
  style?: CSSProperties,
}

// SpotifyIcon — ícono SVG personalizado de Spotify
{
  size?: number,
  className?: string,
}
```

## Catálogo de íconos usados

El componente lazy-carga solo los íconos que se importan. Los más frecuentes:

`Play`, `Pause`, `SkipBack`, `SkipForward`, `Shuffle`, `Repeat`, `Repeat1`, `Heart`, `Plus`, `Share2`, `Music`, `Library`, `Home`, `Search`, `Settings`, `Users`, `ArrowDownToLine`, `CheckCircle`, `AlertCircle`, `X`, `ChevronLeft`, `ChevronRight`, `MoreHorizontal`, `Mic2`, `Radio`

## Notas / Changelog
- 2026-05-22: nivel simple.
- 2026-05-29: registrados `Radio`, `Crown`, `Copy`, `LogIn` (modal de Jam + invitación).
- 2026-05-31: registrados `Trophy`, `Star`, `Award`, `TrendingUp`, `CalendarDays` para el
  rediseño de [[StatsView]]. Antes `Trophy`/`Star`/`Award` **no estaban en el set** → la
  stat card "días récord" y los trofeos 30/100/365 mostraban un cuadro vacío. Recordatorio:
  todo icono usado debe estar en el objeto `ICONS` o no renderiza.
