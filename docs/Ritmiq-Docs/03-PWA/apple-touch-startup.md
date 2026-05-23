---
tipo: modulo
capa: pwa
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: apps/pwa/index.html
tags: [pwa, ios, splash, apple-touch]
---

# Splash images iOS — `apple-touch-startup-image`

> Pantallas de inicio de la PWA en iOS. Apple **ignora el campo `splash` del manifest W3C** — solo lee los `<link rel="apple-touch-startup-image">` con media queries específicas por device.

## Ubicación
`apps/pwa/index.html:24-39` (8 links splash)
`apps/pwa/public/splash/` (8 PNG)

## Por qué existen

Sin estos splash, iOS muestra una **pantalla blanca** al abrir la PWA desde el home screen. UX terrible — el usuario cree que la app está congelada.

Apple no estandarizó esto con el manifest W3C. Solo lee `<link rel="apple-touch-startup-image">` con triple match:
- `device-width` (lógicos, no físicos)
- `device-height`
- `-webkit-device-pixel-ratio` (DPR)
- `orientation`

## Los 8 splash files

| Archivo | Device target | Resolución física |
|---|---|---|
| `iphone-se.png` | iPhone SE 2/3 (375 × 667 @ 2x) | 750 × 1334 |
| `iphone-x.png` | iPhone X/XS/11 Pro (375 × 812 @ 3x) | 1125 × 2436 |
| `iphone-12.png` | iPhone 12/13/14 Mini & Standard (390 × 844 @ 3x) | 1170 × 2532 |
| `iphone-14pro.png` | iPhone 14 Pro/15 Pro (393 × 852 @ 3x) | 1179 × 2556 |
| `iphone-12promax.png` | iPhone 12/13/14 Pro Max & Plus (428 × 926 @ 3x) | 1284 × 2778 |
| `iphone-14promax.png` | iPhone 14 Pro Max/15 Pro Max (430 × 932 @ 3x) | 1290 × 2796 |
| `ipad-air.png` | iPad Air/Mini (768 × 1024 @ 2x) | 1536 × 2048 |
| `ipad-pro-12.png` | iPad Pro 12.9 (1024 × 1366 @ 2x) | 2048 × 2732 |

## Generación

```bash
./scripts/generate-splash.sh
```

Genera los 8 PNG a partir del logotipo + color de fondo. Usa ImageMagick o similar.

## Inclusión en el bundle

En `vite.config.js`:

```js
VitePWA({
  includeAssets: [
    // ...
    'splash/iphone-se.png',
    'splash/iphone-x.png',
    // ... los 8
  ],
})
```

Sin esto, Vite **no copia** los splash a `dist/` al hacer build.

## Limitaciones

- **Solo portrait**: no hay landscape variants. En iPad rotado, iOS muestra fondo negro mientras carga (aceptable).
- **No funciona en Safari (no instalada)**: solo desde el home screen tras Add to Home Screen.
- **Android NO los usa**: Android usa `background_color` + `theme_color` del manifest para construir el splash automáticamente.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Cambiar `device-width` en media query a píxeles físicos | iOS no matchea ninguno → pantalla blanca al abrir. |
| Olvidar `includeAssets` en vite.config | Build no copia los PNG → 404 → pantalla blanca. |
| No regenerar splash al cambiar el logotipo | Splash desactualizado vs UI nueva. |

## Notas / Changelog
- 2026-05-22: nivel simple.
