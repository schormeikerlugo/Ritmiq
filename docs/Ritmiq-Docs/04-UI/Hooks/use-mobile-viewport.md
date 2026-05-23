---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-mobile-viewport.js
tags: [hook, viewport, responsive, media-query]
---

# `useMobileViewport(breakpoint?)`

> Detecta si el viewport actual es mobile vía `matchMedia`. Reactivo a rotaciones y resize.

## Ubicación
`packages/ui/src/lib/use-mobile-viewport.js:1` (26 líneas)

## Firma

```js
function useMobileViewport(breakpoint: number = 768): boolean
```

## Por qué no basta con CSS

La lógica de renderizado (ej. mostrar BottomNav vs Sidebar, ajustar comportamientos de swipe) necesita saber en JS si estamos en mobile. `matchMedia` es la forma correcta: respeta las preferencias del usuario, no depende de `window.innerWidth` que no dispara eventos.

## Distinción importante

```
useMobileViewport() === true  →  ancho < 768px
isDesktop (de api.js) === true  →  corriendo en Electron
```

En Electron con ventana estrecha: `useMobileViewport() = true` pero `isDesktop = true`. Los componentes que deben ser específicos de Electron usan `isDesktop`, no este hook.

## Código completo

```js
export function useMobileViewport(breakpoint = 768) {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
  });
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [breakpoint]);
  return mobile;
}
```

**Por qué `useState` inicializado con función**: evita flash de estado incorrecto en el primer render. El valor inicial se calcula de `matchMedia` sincrónicamente.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Usar `window.innerWidth < 768` en lugar de matchMedia | No reactivo a rotación ni a resize gradual en desktop. |
| Quitar el `addEventListener` | Cambiar tamaño de ventana no actualiza el estado. |

## Notas / Changelog
- 2026-05-22: nivel simple.
