---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/Skeleton/Skeleton.jsx
tags: [componente, skeleton, loading, shimmer]
---

# `Skeleton` / `HeroSkeleton` / `TrackRowSkeleton`

> Componentes de placeholder de carga con animación shimmer. Se muestran mientras los datos cargan (patrón skeleton screen).

## Ubicación
`packages/ui/src/components/Skeleton/Skeleton.jsx:1`
`packages/ui/src/components/Skeleton/index.js` (exports)

## Exports via `index.js`

```js
export { Skeleton }           // bloque genérico con dimensiones personalizables
export { HeroSkeleton }       // placeholder del hero de PlaylistView / ArtistView
export { TrackRowSkeleton }   // fila de track placeholder (cover 56px + líneas)
```

## Props de `Skeleton`

```js
{
  width?: string | number,
  height?: string | number,
  borderRadius?: string,
  style?: CSSProperties,
}
```

## Animación

CSS `@keyframes shimmer` con `background: linear-gradient(90deg, var(--skeleton-base), var(--skeleton-highlight), var(--skeleton-base))` moviéndose de izquierda a derecha. Los tokens de color respetan el tema dark/light.

## Notas / Changelog
- 2026-05-22: nivel simple.
- 2026-05-27 (Fase 2.3): `RowSkeleton` (usado por [[Home]]) ahora replica fielmente el `HomeRow` final: añade `subLine` placeholder + `playBtnSkel` (pill con dot + line) + variante `shape='circle'` para skeletons de artistas. Layout no salta cuando llegan los datos reales. Commit `ac13429`.
