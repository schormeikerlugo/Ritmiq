/**
 * Backend de audio nativo basado en un único `<audio>` HTMLMediaElement
 * persistente para toda la sesión.
 *
 * Por qué reemplaza a Howler:
 *  - Howler en modo `html5: true` recrea un nuevo `<audio>` con cada `load()`.
 *  - iOS sólo mantiene reproducción en background cuando el MISMO `<audio>`
 *    recibe `play()` y fue activado dentro de un gesto de usuario al inicio
 *    de la sesión.
 *
 * Por qué usamos BLOB URLS en lugar de HTTP directo:
 *  - iOS decide el layout del lockscreen (música con prev/next vs podcast
 *    con ±10s) en función de si `audio.duration` es finita.
 *  - Stream HTTP con Range y chunked sin Content-Length deja `audio.duration`
 *    como Infinity → iOS muestra podcast UI ±10s.
 *  - Un blob URL `blob:` es siempre un archivo finito conocido → iOS lo
 *    trata como música y muestra prev/next.
 *  - El coste: ~2-5s de latencia en la primera canción mientras se descarga
 *    el archivo completo. El resto se mitigan con precarga del siguiente.
 */

/** Cache de blob URLs creados para revocarlos al cambiar. */
const liveBlobUrls = new Set();

function revokeAllExcept(currentUrl) {
  for (const url of liveBlobUrls) {
    if (url !== currentUrl) {
      try { URL.revokeObjectURL(url); } catch {}
      liveBlobUrls.delete(url);
    }
  }
}

/**
 * Descarga una URL como blob y devuelve un blob: URL local.
 * Si la URL ya es un blob:, file: o data:, la devuelve tal cual (downloads).
 * @param {string} url
 * @param {(pct:number)=>void} [onProgress]
 * @returns {Promise<string>}
 */
async function urlToBlobUrl(url, onProgress) {
  if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('file:')) {
    return url;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`fetch failed (${res.status})`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const mime = res.headers.get('content-type') ?? 'audio/mp4';

  const reader = res.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0 && onProgress) onProgress((received / total) * 100);
  }
  const blob = new Blob(chunks, { type: mime });
  const blobUrl = URL.createObjectURL(blob);
  liveBlobUrls.add(blobUrl);
  return blobUrl;
}

/** Crea el `<audio>` singleton montado en el DOM y devuelve el backend. */
export function createHtmlAudioBackend() {
  /** @type {HTMLAudioElement|null} */
  let audio = null;
  /** @type {Set<() => void>} */
  const endedCbs = new Set();
  /** @type {Set<(p:number) => void>} */
  const posCbs = new Set();
  /** URL actualmente cargada (blob:). */
  let currentBlobUrl = null;

  /** Activador del audioSession iOS 17+ y atributos críticos para background. */
  function ensureAudio() {
    if (audio) return audio;
    // Usar el constructor `new Audio()` en vez de createElement: iOS Safari
    // distingue ambos y `new Audio()` lo trata como reproductor de música.
    audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    // crossOrigin solo se aplica si el server manda CORS — para blob URLs
    // no aplica y puede causar problemas si se setea.
    // NO usamos display:none — iOS puede tratar audio oculto como background
    // loop / ambient. Lo dejamos en el DOM con tamaño cero pero visible.
    audio.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;';
    document.body.appendChild(audio);

    audio.addEventListener('timeupdate', () => {
      for (const cb of posCbs) cb(audio.currentTime);
    });
    audio.addEventListener('ended', () => {
      for (const cb of endedCbs) cb();
    });
    try {
      if ('audioSession' in navigator) {
        // @ts-ignore – API experimental no tipada
        navigator.audioSession.type = 'playback';
      }
    } catch {}
    return audio;
  }

  return {
    init() { ensureAudio(); },
    element() { return audio; },

    /**
     * Pre-fetch de la URL → blob URL. Llamar para precargar la siguiente
     * canción y conseguir swap síncrono sin gap.
     * @param {string} url
     * @returns {Promise<string>}
     */
    async prepare(url) {
      const blobUrl = await urlToBlobUrl(url);
      return blobUrl;
    },

    /**
     * Carga una URL en el `<audio>` reusando el mismo elemento.
     * Si la URL es http(s), se descarga como blob primero para que iOS la
     * trate como archivo finito en el lockscreen.
     * @param {string} url
     */
    async load(url) {
      const el = ensureAudio();
      const blobUrl = await urlToBlobUrl(url);
      return new Promise((resolve, reject) => {
        const onLoaded = () => { cleanup(); resolve(); };
        const onError = () => {
          cleanup();
          const code = el.error?.code ?? 0;
          reject(new Error(`audio load failed (code ${code})`));
        };
        const cleanup = () => {
          el.removeEventListener('loadedmetadata', onLoaded);
          el.removeEventListener('canplay', onLoaded);
          el.removeEventListener('error', onError);
        };
        el.addEventListener('loadedmetadata', onLoaded, { once: true });
        el.addEventListener('canplay', onLoaded, { once: true });
        el.addEventListener('error', onError, { once: true });
        el.src = blobUrl;
        el.load();
        // Revocamos blobs antiguos (excepto el actual) para liberar memoria.
        revokeAllExcept(blobUrl);
        currentBlobUrl = blobUrl;
      });
    },

    async play() {
      const el = ensureAudio();
      await el.play();
    },

    pause() { audio?.pause(); },

    seek(sec) { if (audio) audio.currentTime = sec; },

    setVolume(v) { if (audio) audio.volume = Math.max(0, Math.min(1, v)); },

    onEnded(cb) { endedCbs.add(cb); return () => endedCbs.delete(cb); },
    onPosition(cb) { posCbs.add(cb); return () => posCbs.delete(cb); },

    duration() { return audio?.duration ?? 0; },

    /**
     * Cambio SÍNCRONO de src + play, pensado para llamarse dentro del
     * timeupdate o evento `ended`. La URL DEBE ser ya un blob: URL (obtenida
     * vía `prepare()` previamente).
     * @param {string} blobUrl
     */
    swapAndPlay(blobUrl) {
      const el = ensureAudio();
      el.src = blobUrl;
      el.load();
      revokeAllExcept(blobUrl);
      currentBlobUrl = blobUrl;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    },

    dispose() {
      if (audio) {
        try { audio.pause(); } catch {}
        try { audio.removeAttribute('src'); audio.load(); } catch {}
        try { audio.remove(); } catch {}
        audio = null;
      }
      for (const url of liveBlobUrls) {
        try { URL.revokeObjectURL(url); } catch {}
      }
      liveBlobUrls.clear();
      currentBlobUrl = null;
      endedCbs.clear();
      posCbs.clear();
    },
  };
}
