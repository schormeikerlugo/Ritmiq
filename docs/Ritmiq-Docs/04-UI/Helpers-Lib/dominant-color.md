---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/dominant-color.js
tags: [helper, color, canvas, imagen, cache]
---

# `lib/dominant-color.js`

> Extracción del color dominante de una imagen via canvas 24×24. Promedio ponderado por saturación (los píxeles vivos pesan más que los grises). Cache por URL + coalescing de inflight.

## Ubicación
`packages/ui/src/lib/dominant-color.js:1` (85 líneas)

## Firma

```js
async function getDominantColor(url: string): Promise<string | null>
// Devuelve 'rgb(r, g, b)' oscurecido 30%, o null si CORS/error
```

## Anatomía del código (snippet clave)

### Ponderación por saturación
`packages/ui/src/lib/dominant-color.js:46-72`

```js
for (let i = 0; i < data.length; i += 4) {
  const saturation = max === 0 ? 0 : (max - min) / max;
  // Ignorar píxeles muy oscuros o muy claros (bordes, fondos blancos).
  const lum = (pr * 0.299 + pg * 0.587 + pb * 0.114) / 255;
  if (lum < 0.1 || lum > 0.95) continue;
  const w = 0.3 + saturation;  // píxeles saturados pesan más
  r += pr * w; g += pg * w; b += pb * w;
  totalWeight += w;
}
const darken = 0.7;  // oscurecer para que el texto blanco sea legible
```

**Por qué ponderación por saturación**: un promedio puro devolvería un gris marrón aburrido para la mayoría de carátulas. Los píxeles saturados (el color "vibrante" de la portada) dominan el resultado.

**Por qué oscurecer 30%**: el color se usa como fondo de la UI de NowPlaying. Sin oscurecer, el texto blanco puede no tener contraste suficiente.

## Cache y coalescing

- `Map<url, color>` en memoria — no persiste entre sesiones.
- `Map<url, Promise>` para inflight — múltiples llamadas simultáneas a la misma URL comparten la misma Promise.

## Casos de borde

- **CORS bloqueado**: `img.crossOrigin = 'anonymous'` pero si el servidor no devuelve `Access-Control-Allow-Origin` → `onerror` → devuelve `null` y cachea null.
- **Imagen con todos los píxeles muy oscuros/claros**: `totalWeight === 0` → `null`.

## Notas / Changelog
- 2026-05-22: nivel simple.
