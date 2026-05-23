---
tipo: componente
capa: ui
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/IOSInstallHint/IOSInstallHint.jsx
tags: [componente, ios, install, pwa, onboarding]
---

# `IOSInstallHint`

> Banner con instrucciones específicas de instalación para iOS Safari (Add to Home Screen). Solo visible en iOS no-standalone.

## Ubicación
`packages/ui/src/components/IOSInstallHint/IOSInstallHint.jsx:1` (225 líneas)

## Props
Sin props.

## Condición de render

```js
const shouldShow = 
  detectPlatform() === 'ios' &&    // es iOS
  !isStandalonePWA() &&            // no está instalada
  !hasPwaInstalledCookie() &&      // nunca ha estado instalada
  !dismissed;                       // el usuario no cerró el banner hoy
```

## Contenido

Pasos visuales del Add to Home Screen de iOS:
1. Tap en el botón "Compartir" (ícono de caja con flecha).
2. Deslizar abajo y tocar "Añadir a pantalla de inicio".
3. Confirmar con "Añadir".

## Dismiss persistido en sessionStorage

El usuario puede cerrar el banner; no vuelve a aparecer en la misma sesión del navegador. Al día siguiente puede volver a mostrarse.

## Notas / Changelog
- 2026-05-22: nivel simple.
