---
tipo: componente
capa: ui
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/PullToRefresh/PullToRefresh.jsx
tags: [componente, pull-to-refresh, indicador, mobile]
---

# `PullIndicator`

> Componente visual del indicador de pull-to-refresh (flecha + spinner). Usado junto al hook [[use-pull-to-refresh]].

## Ubicación
`packages/ui/src/components/PullToRefresh/PullToRefresh.jsx:1` (79 líneas)

## Props

```js
{
  pullDistance: number,  // px actuales de pull (0..140)
  refreshing: boolean,   // true mientras onRefresh() está pendiente
  threshold?: number,    // default 70 — a partir de aquí la flecha gira
}
```

## Visual

- `pullDistance < threshold`: flecha `ChevronDown` con opacidad proporcional al pull.
- `pullDistance >= threshold`: flecha rota 180° (apunta arriba — "suelta para refrescar").
- `refreshing`: spinner circular animado.

## Patrón de uso

```jsx
const { bind, pullDistance, refreshing } = usePullToRefresh({ onRefresh });
return (
  <div {...bind} style={{ transform: `translateY(${pullDistance}px)` }}>
    <PullIndicator pullDistance={pullDistance} refreshing={refreshing} />
    <Content />
  </div>
);
```

## Notas / Changelog
- 2026-05-22: nivel simple.
