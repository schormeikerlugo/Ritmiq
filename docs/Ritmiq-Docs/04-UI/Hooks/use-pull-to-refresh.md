---
tipo: hook
capa: ui
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-pull-to-refresh.js
tags: [hook, pull-to-refresh, touch, mobile, ux]
---

# `usePullToRefresh({onRefresh, disabled?})`

> Pull-to-refresh para PWA mobile. Solo activo en viewport < 768px y cuando el scroll del contenedor está en el top. Damping sqrt para resistencia física.

## Ubicación
`packages/ui/src/lib/use-pull-to-refresh.js:1` (110 líneas)

## Firma

```js
function usePullToRefresh({
  onRefresh: () => void | Promise<void>,
  disabled?: boolean
}): {
  bind: { onTouchStart, onTouchMove, onTouchEnd } | {},
  pullDistance: number,  // px desplazados (0..140)
  refreshing: boolean,
}
```

## Constantes

```js
const PULL_THRESHOLD = 70;   // px para confirmar refresh
const MAX_PULL = 140;        // tope visual con damping
```

## Anatomía del código (snippets clave)

### Damping sqrt para sensación física
`packages/ui/src/lib/use-pull-to-refresh.js:74-76`

```js
const damped = Math.min(MAX_PULL, Math.sqrt(dy) * 8);
setPullDistance(damped);
```

**Por qué sqrt**: la resistencia al tirar debe aumentar a medida que se estira. `sqrt(dy) * 8` da:
- 10px pull → `sqrt(10)*8 = 25px` visual (alta respuesta inicial)
- 70px pull → `sqrt(70)*8 = 67px` visual (~1:1 al threshold)
- 200px pull → `sqrt(200)*8 = 113px` visual (amortiguado)

Lineal daría sensación de "elástico roto". El sqrt replica la sensación nativa de iOS.

### `findScrollParent`: encontrar el ancestro scrolleable
`packages/ui/src/lib/use-pull-to-refresh.js:45-56`

```js
const findScrollParent = (el) => {
  let node = el;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const oy = style.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
};
```

**Por qué buscar el ancestro y no usar el elemento directamente**: en Ritmiq el scroll vive en `.main` del App shell, no en el elemento que recibe el touch. El `onTouchStart` se dispara en el elemento hijo; hay que escalar hasta encontrar el contenedor real para leer `scrollTop`.

## Casos de borde

- **Desktop**: `bind: {}` (sin handlers). No añade overhead en Electron.
- **Scroll no en top**: `if (scrollEl.scrollTop > 0) return` — no inicia el pull si el usuario está scrolleando hacia abajo.
- **`onRefresh` async que lanza**: `try/catch` silencioso → `refreshing: false` + `pullDistance: 0`. El error debe manejarse dentro de `onRefresh`.
- **Pull < threshold**: al soltar, `pullDistance` vuelve a 0 sin llamar `onRefresh`.

## Uso típico

```jsx
const { bind, pullDistance, refreshing } = usePullToRefresh({
  onRefresh: async () => { await store.load(); },
});
return (
  <div {...bind} style={{ transform: `translateY(${pullDistance}px)` }}>
    {refreshing && <Spinner />}
    <Content />
  </div>
);
```

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| `dy * 1` en lugar de `sqrt(dy) * 8` | Pull lineal — sensación de "elástico roto". |
| No buscar scroll parent (usar `currentTarget.scrollTop`) | Pull dispara incluso cuando el usuario hace scroll normal hacia abajo. |

## Notas / Changelog
- 2026-05-22: nivel medio.
