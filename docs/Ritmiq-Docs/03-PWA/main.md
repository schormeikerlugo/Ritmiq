---
tipo: modulo
capa: pwa
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: apps/pwa/src/main.jsx
tags: [pwa, bootstrap, react]
---

# `pwa/src/main.jsx`

> Entry point de la PWA. Idéntico al [[main|apps/desktop/renderer/src/main.jsx]] del Desktop — monta `<App />` de `@ritmiq/ui` en `#root` e instala el bloqueador de zoom.

## Ubicación
`apps/pwa/src/main.jsx:1` (13 líneas)

## Código completo

`apps/pwa/src/main.jsx:1-13`

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

## Por qué es idéntico al Desktop renderer

La PWA y el Desktop renderer ejecutan el mismo bundle `@ritmiq/ui`. La detección de entorno (Desktop vs PWA) ocurre en runtime via `isDesktop = typeof window.ritmiq !== 'undefined'` ([[api]]). El `<App />` decide internamente qué componentes y comportamientos cargar.

## Service Worker registration

**No registrado aquí explícitamente** — lo hace `VitePWA` con `registerType: 'autoUpdate'` ([[manifest-y-service-worker]]). En el bundle final se inyecta automáticamente un registrador que llama `navigator.serviceWorker.register('/sw.js')`.

## Service Worker push messages

El SW envía `postMessage({ type: 'push-click', data, action })` cuando el usuario clickea una notificación push (ver [[sw-push]]). El listener vive dentro de `<App />` (no en `main.jsx`) y rutea a la vista correspondiente.

## Dependencias

- React 18 (`react`, `react-dom/client`).
- [[App|@ritmiq/ui App]].
- [[block-zoom]].
- `@ritmiq/ui/styles/global.css`.

## Side-effects

- Modifica el DOM (`#root`).
- Instala listeners de zoom (`wheel`, `keydown`, `gesturestart`, `touchend`).
- (Indirecto via VitePWA) registra el Service Worker en `/sw.js`.

## Notas / Changelog
- 2026-05-22: nivel simple.
