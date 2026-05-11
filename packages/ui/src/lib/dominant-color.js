/**
 * Extracción del color dominante de una imagen via canvas. Cache por URL.
 * Devuelve un string `rgb(r, g, b)` que puede usarse en CSS.
 *
 * Si la imagen tiene CORS no permitido, devuelve null (caller hace fallback).
 */

/** @type {Map<string,string|null>} */
const cache = new Map();
/** @type {Map<string,Promise<string|null>>} */
const inflight = new Map();

const FALLBACK = null;

/**
 * @param {string} url
 * @returns {Promise<string|null>}
 */
export function getDominantColor(url) {
  if (!url) return Promise.resolve(FALLBACK);
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (inflight.has(url)) return inflight.get(url);

  const p = (async () => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.src = url;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      const canvas = document.createElement('canvas');
      // Reducimos a un tamaño pequeño para acelerar el sampleo.
      const SIZE = 24;
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return FALLBACK;
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

      // Promedio simple con ponderación por saturación (los píxeles vivos
      // pesan más que los grises) — produce colores más interesantes que un
      // promedio puro.
      let r = 0, g = 0, b = 0, totalWeight = 0;
      for (let i = 0; i < data.length; i += 4) {
        const pr = data[i], pg = data[i + 1], pb = data[i + 2], pa = data[i + 3];
        if (pa < 128) continue;
        const max = Math.max(pr, pg, pb);
        const min = Math.min(pr, pg, pb);
        const saturation = max === 0 ? 0 : (max - min) / max;
        // Ignorar pixels muy oscuros o muy claros para evitar muestrear bordes.
        const lum = (pr * 0.299 + pg * 0.587 + pb * 0.114) / 255;
        if (lum < 0.1 || lum > 0.95) continue;
        const w = 0.3 + saturation;
        r += pr * w;
        g += pg * w;
        b += pb * w;
        totalWeight += w;
      }
      if (totalWeight === 0) return FALLBACK;
      r = Math.round(r / totalWeight);
      g = Math.round(g / totalWeight);
      b = Math.round(b / totalWeight);
      // Oscurecemos un poco para que el texto sea legible.
      const darken = 0.7;
      r = Math.round(r * darken);
      g = Math.round(g * darken);
      b = Math.round(b * darken);
      const color = `rgb(${r}, ${g}, ${b})`;
      cache.set(url, color);
      return color;
    } catch (e) {
      cache.set(url, FALLBACK);
      return FALLBACK;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, p);
  return p;
}
