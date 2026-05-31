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
    let blobUrl = null;
    try {
      const img = await loadSampleableImage(url);
      if (img.blobUrl) blobUrl = img.blobUrl;
      const el = img.el;
      const canvas = document.createElement('canvas');
      // Reducimos a un tamaño pequeño para acelerar el sampleo.
      const SIZE = 24;
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return FALLBACK;
      ctx.drawImage(el, 0, 0, SIZE, SIZE);
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
      if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch {} }
      inflight.delete(url);
    }
  })();

  inflight.set(url, p);
  return p;
}

/**
 * Carga una imagen que el canvas pueda leer sin quedar "tainted".
 *
 * El problema: las covers (YouTube, Last.fm) no devuelven cabeceras CORS, y
 * desde la Fase 7.3 el Service Worker las cachea como respuestas *opaque*.
 * Una `new Image()` con `crossOrigin='anonymous'` falla contra una respuesta
 * opaque → `getImageData` lanza SecurityError → background gris.
 *
 * Solución: `fetch()` de la URL (pasa por el SW cache y devuelve el body
 * como blob), creamos un `blob:` URL same-origin y cargamos la imagen desde
 * ahí. Un blob: URL nunca queda tainted, así que `getImageData` funciona.
 * Si el fetch falla (sin red y sin cache), fallback a `<img>` directo (que
 * al menos dibuja, aunque podría quedar tainted → caería al catch del caller).
 *
 * @param {string} url
 * @returns {Promise<{ el: HTMLImageElement, blobUrl: string|null }>}
 */
async function loadSampleableImage(url) {
  try {
    // mode 'cors' + referrer none: i.ytimg.com y la mayoría de CDNs de
    // covers devuelven CORS. El body se lee como blob → blob: URL same-origin
    // que el canvas puede leer sin tainting (sirve aunque el SW lo intercepte
    // con una respuesta CORS cacheada).
    const res = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    if (res.ok) {
      const blob = await res.blob();
      // Una respuesta opaque (SW) puede dar un blob de tamaño 0 → inservible.
      if (blob && blob.size > 0) {
        const blobUrl = URL.createObjectURL(blob);
        const el = await loadImg(blobUrl);
        return { el, blobUrl };
      }
    }
  } catch {
    // Sigue al fallback.
  }
  // Fallback: <img crossOrigin> directo, evitando el cache del SW con un
  // cache-buster (el pattern del SW no matchea con query distinto → red
  // directa con CORS real, no la opaque cacheada).
  const el = new Image();
  el.crossOrigin = 'anonymous';
  el.referrerPolicy = 'no-referrer';
  el.src = url + (url.includes('?') ? '&' : '?') + 'dc=1';
  await loadImgEl(el);
  return { el, blobUrl: null };
}

/** Carga una imagen desde un src y resuelve el elemento. */
function loadImg(src) {
  const el = new Image();
  el.src = src;
  return loadImgEl(el).then(() => el);
}

/** Resuelve cuando la imagen carga (o rechaza al fallar). */
function loadImgEl(el) {
  return new Promise((resolve, reject) => {
    if (el.complete && el.naturalWidth > 0) { resolve(); return; }
    el.onload = () => resolve();
    el.onerror = reject;
  });
}
