---
tipo: modulo
capa: desktop-renderer
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: apps/desktop/renderer/src/main.jsx
tags: [desktop, renderer, react, bootstrap]
---

# `renderer/src/main.jsx`

> Entry point del renderer de Electron. Monta el árbol React de `@ritmiq/ui` en `#root` e instala el bloqueador de zoom global.

## Ubicación
`apps/desktop/renderer/src/main.jsx:1` (13 líneas)

## Anatomía del código (archivo completo)

`apps/desktop/renderer/src/main.jsx:1-13`

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@ritmiq/ui';
import { installZoomBlocker } from '@ritmiq/ui/lib/block-zoom.js';
import '@ritmiq/ui/styles/global.css';

installZoomBlocker();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

**Por qué `StrictMode`**: detecta side-effects no idempotentes en `useEffect` montando dos veces en dev. Crítico para validar cleanups de listeners IPC ([[preload|preload/index.cjs]]) — si olvidaste el unsubscribe, StrictMode lo expone al instante.

**Por qué CSS global aquí, no dentro de `App`**: las variables CSS (theme, colores, tipografía) deben cargarse antes de cualquier componente. Cargarlo en el entry garantiza orden. Si lo metés en `App`, durante el primer render hay un FOUC visible.

**Por qué `installZoomBlocker()` duplica la protección del main**: [[index|main/index.js]] bloquea zoom via Electron (`setVisualZoomLevelLimits`, `before-input-event`). [[block-zoom]] añade defensa del lado renderer (event listeners en `wheel` y `keydown`). Si el main falla por alguna razón (atajos no detectados, gestos trackpad), el renderer todavía bloquea.

## Vite

Servido por `apps/desktop/vite.config.js` en dev (`http://localhost:5174`) o empaquetado a `renderer/dist/` en producción. La carga la elige [[index|main/index.js]] con `loadURL` o `loadFile`.

## Diferencia con la PWA

El renderer del Desktop y el bootstrap de la PWA ([[main|apps/pwa/src/main.jsx]]) hacen prácticamente lo mismo: importan `<App />` de `@ritmiq/ui`. La PWA añade registro de Service Worker.

## Dependencias entrantes
- Cargado por `apps/desktop/renderer/index.html` (Vite).

## Dependencias salientes
- React 18 (`react`, `react-dom/client`).
- [[App|@ritmiq/ui App]].
- [[block-zoom|@ritmiq/ui/lib/block-zoom]].
- `@ritmiq/ui/styles/global.css`.

## Side-effects
- Modifica el DOM (`#root`).
- Instala event listeners globales de zoom (`wheel`, `keydown`).

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar `StrictMode` | Bugs de cleanup quedan latentes; aparecen como leaks en producción mucho después. |
| Mover CSS global dentro de `<App>` | FOUC visible: la app aparece sin estilos por unos ms. |
| Quitar `installZoomBlocker()` | Trackpad pinch hace zoom de la UI; layout se rompe; user atrapado. |
| Cambiar `#root` por otro id | React no encuentra el contenedor → pantalla en blanco silenciosa. |

## Notas / Changelog
- 2026-05-22: nivel simple.
