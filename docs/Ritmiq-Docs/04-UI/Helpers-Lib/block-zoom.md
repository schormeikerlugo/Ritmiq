---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/block-zoom.js
tags: [helper, zoom, ios, ux]
---

# `lib/block-zoom.js`

> Bloquea pinch-zoom, double-tap zoom (iOS Safari) y Ctrl+wheel/Ctrl+teclas (desktop). Llamar una sola vez al iniciar la app.

## Ubicación
`packages/ui/src/lib/block-zoom.js:1` (33 líneas)

## Export

```js
function installZoomBlocker(): void
```

## Por qué `user-scalable=no` no alcanza

iOS Safari ignora el meta viewport `user-scalable=no` por razones de accesibilidad. El único mecanismo confiable es bloquear los eventos natively:

- `gesturestart/change/end` → bloquea pinch con `preventDefault`.
- `touchend` doble tap (< 300ms entre toques) → `preventDefault`.
- `wheel` con `ctrlKey` → `preventDefault`.
- `keydown` con `Ctrl/Cmd` + `=/-/0/+` → `preventDefault`.

## Llamado desde

- [[renderer/main|apps/desktop/renderer/src/main.jsx]] → `installZoomBlocker()` al boot.
- PWA `apps/pwa/src/main.jsx` → idem.
- [[index|apps/desktop/main/index.js]] también bloquea zoom desde el lado Electron (doble protección).

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Quitar listener `gesturestart` | Pinch-zoom funciona en iOS → layout se rompe al estirar la UI. |
| `passive: true` en gesturestart | `preventDefault()` ignorado → el bloqueo no funciona. |

## Notas / Changelog
- 2026-05-22: nivel simple.
