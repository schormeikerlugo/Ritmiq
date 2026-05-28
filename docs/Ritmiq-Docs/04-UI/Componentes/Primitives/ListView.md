---
tipo: componente
capa: ui
plataforma: ambas
estado: beta
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/primitives/ListView.jsx
tags: [componente, primitive, virtualization, list, performance]
---

# `<ListView>`

> Primitive de lista vertical con virtualización opt-in. Implementación propia sin `react-window` ni `@tanstack/react-virtual` para mantener el bundle limpio.

## Ubicación
`packages/ui/src/components/primitives/ListView.jsx:1` (~150 líneas)

## Estado

`beta`: el primitive existe y compila, pero **no ha sido adoptado por ningún componente todavía**. Library, Downloads, PlaylistView siguen con su markup propio. Se migrarán incrementalmente cuando alguna lista supere los 200 items y muestre jank.

## Por qué existe

Ver [[Decisiones-Tecnicas-ADR|ADR-010]].

## Props

```js
<ListView
  items={tracks}
  renderItem={(item, index, style) => <TrackRow track={item} />}
  itemHeight={56}                  // requerido si virtualize=true
  virtualize={false}                // default
  overscan={4}                      // items extra arriba/abajo
  keyExtractor={(item) => item.id}
  className={styles.myList}
  style={{}}
  empty={<EmptyState />}
  ariaLabel="Lista de tracks"
  onScroll={(scrollTop) => trackPosition(scrollTop)}
/>
```

| Prop | Tipo | Default | Notas |
|---|---|---|---|
| `items` | `T[]` | — | Datos a renderizar |
| `renderItem` | `(item, i, style?) => JSX` | — | El `style` sugerido viene con `height: itemHeight` cuando virtualizado |
| `itemHeight` | `number` | — | px. **Requerido** si `virtualize=true` |
| `virtualize` | `boolean` | `false` | Sin virt para listas pequeñas (< 100) |
| `overscan` | `number` | `4` | Items extra arriba/abajo del viewport |
| `keyExtractor` | `(item, i) => string` | `item.id ?? item.key ?? i` | Para `React key` |
| `empty` | `ReactNode` | — | Render si `items.length === 0` |

## Modo no virtualizado

Renderiza todos los `items` en su `<div>` envoltorio. Sin overhead de measurement. Permite anchor scroll a items no visibles vía `querySelector`.

## Modo virtualizado

```js
const totalHeight = total * itemHeight;
const visibleCount = Math.ceil(viewportH / itemHeight) + overscan * 2;
const startIdx = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
const endIdx = Math.min(total, startIdx + visibleCount);
```

Spacers top y bottom con `height` calculado mantienen el scroll height correcto. El scrollbar refleja el tamaño real de la lista completa.

## Throttle

`onScroll` con `requestAnimationFrame`:

```js
if (rafRef.current) return;
rafRef.current = requestAnimationFrame(() => {
  rafRef.current = 0;
  setScrollTop(target.scrollTop);
});
```

Evita re-renders por frame en scrolls rápidos.

## ResizeObserver

Si el viewport del container cambia (resize de ventana, abrir/cerrar paneles laterales), `setViewportH` se actualiza y el slice se recalcula automáticamente.

## Limitaciones V1

- **`itemHeight` uniforme**. Listas con altura variable no soportadas. Si se necesitan, evaluar `@tanstack/react-virtual` que sí lo soporta.
- **No `scrollToIndex` expuesto**. Si hace falta, agregar como ref handle.
- **No keyboard navigation auto** (arrow keys). El caller debe implementarlo si lo necesita.

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Cambiar default de `virtualize` a `true` | Componentes que usan ListView sin pasar `itemHeight` empiezan a fallar |
| Quitar `ResizeObserver` (browsers viejos) | Cambios de viewport no recalculan; UX rota tras resize |
| Cambiar el throttle de rAF a setTimeout 16ms | Stuttering visible en mobile high-refresh |

## Casos de borde

- **`items.length === 0` y `empty` definido**: renderiza solo el `empty` dentro del container.
- **`itemHeight=0`**: emite warning en console; modo virtualizado degenerado (no renderiza ningún item).
- **Container con `display:none` al mount**: viewport=0 → no se renderiza nada; el ResizeObserver lo detectará cuando se haga visible.

## Changelog

- 2026-05-27 — Creado en Fase 3.1. Commit `70ba5a0`. Aún no adoptado por ningún caller.
