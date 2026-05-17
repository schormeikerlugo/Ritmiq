/**
 * Backend de audio nativo basado en un único `<audio>` HTMLMediaElement
 * persistente para toda la sesión.
 *
 * Diseño:
 *  - `load(url)` asigna `audio.src = url` DIRECTAMENTE y resuelve apenas el
 *    elemento puede empezar a reproducir (`canplay`). NO descarga el archivo
 *    completo antes de tocar — eso producía latencias de varios segundos
 *    para canciones grandes y hacía que pareciera que "no suena".
 *  - El `<audio>` element es ÚNICO y se reutiliza entre canciones para que
 *    iOS conserve la autorización del primer gesto del usuario y siga
 *    reproduciendo en background al cambiar de pista.
 *  - `prepare(url)` opcional: pre-fetch a blob URL para casos donde se
 *    necesita un swap síncrono e instantáneo (precarga del siguiente track).
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
 * Pre-fetch de una URL a Blob URL. Solo para precarga del siguiente track.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function urlToBlobUrl(url) {
  if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('file:')) {
    return url;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`fetch failed (${res.status})`);
  const mime = res.headers.get('content-type') ?? 'audio/mp4';
  const buf = await res.arrayBuffer();
  const blob = new Blob([buf], { type: mime });
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
  /** URL actualmente cargada. */
  let currentSrc = null;

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
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
        // @ts-ignore – API experimental
        navigator.audioSession.type = 'playback';
      }
    } catch {}
    return audio;
  }

  return {
    init() { ensureAudio(); },
    element() { return audio; },

    /**
     * Pre-fetch opcional a blob URL. Útil para precarga del siguiente track
     * cuando se necesita swap instantáneo. NO se usa en `load()` para no
     * bloquear el inicio de reproducción.
     */
    async prepare(url) {
      return urlToBlobUrl(url);
    },

    /**
     * Carga una URL en el `<audio>` reusando el mismo elemento.
     * Resuelve apenas el elemento puede empezar a reproducir (canplay).
     *
     * CONTEXTO HISTÓRICO: esta función aceptaba `opts.fallbackUrl` para
     * reintentar automáticamente con la URL del proxy si la URL directa
     * de googlevideo daba 403. Se removió tras confirmar que el camino
     * directo siempre falla por IP-lock — el doble round-trip era pura
     * pérdida de tiempo. Volver a introducirlo si se implementa re-firma
     * de URLs o mesh con misma IP (Tailscale).
     *
     * @param {string} url
     */
    load(url) {
      const el = ensureAudio();
      return new Promise((resolve, reject) => {
        const onCanPlay = () => { cleanup(); resolve(); };
        const onError = () => {
          cleanup();
          const code = el.error?.code ?? 0;
          reject(new Error(`audio load failed (code ${code})`));
        };
        const cleanup = () => {
          el.removeEventListener('loadeddata', onCanPlay);
          el.removeEventListener('canplay', onCanPlay);
          el.removeEventListener('error', onError);
        };
        // CRITICO antes de cambiar src: pausar + reset.
        //
        // Safari (iOS y macOS) tiene un bug clasico: si cambias `src`
        // mientras una fetch anterior aun esta en vuelo, bytes de la
        // request anterior contaminan el media decoder de la nueva src
        // y disparan MEDIA_ERR_DECODE (code 3) — sintoma: "no puedo
        // cambiar de cancion despues de varias veces".
        //
        // pause() + removeAttribute('src') + load() fuerza el cierre de
        // cualquier connection pendiente y resetea el media engine antes
        // de asignar la URL nueva. Sin esto, switches rapidos rompen.
        try {
          if (!el.paused) el.pause();
          if (el.src) {
            el.removeAttribute('src');
            el.load();
          }
        } catch {}
        // Resolver tan pronto como haya datos suficientes para empezar.
        // `loadeddata` dispara antes que `canplay` y suele bastar para play().
        el.addEventListener('loadeddata', onCanPlay, { once: true });
        el.addEventListener('canplay', onCanPlay, { once: true });
        el.addEventListener('error', onError, { once: true });
        el.src = url;
        revokeAllExcept(url);
        currentSrc = url;
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
     * timeupdate (~0.4s antes del `ended` de la actual). Permite que iOS
     * conserve la autorización para reproducir en background.
     * Acepta URL HTTP o blob URL.
     */
    swapAndPlay(url) {
      const el = ensureAudio();
      el.src = url;
      revokeAllExcept(url);
      currentSrc = url;
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
      currentSrc = null;
      endedCbs.clear();
      posCbs.clear();
    },
  };
}
