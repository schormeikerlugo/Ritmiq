/**
 * Backend de audio nativo basado en un único `<audio>` HTMLMediaElement
 * persistente para toda la sesión.
 *
 * Por qué reemplaza a Howler:
 *  - Howler en modo `html5: true` recrea un nuevo `<audio>` con cada `load()`.
 *  - iOS sólo mantiene reproducción en background cuando el MISMO `<audio>`
 *    recibe `play()` y fue activado dentro de un gesto de usuario al inicio
 *    de la sesión. Al recrearse el elemento, iOS pierde la autorización y
 *    silencia/suspende la sesión al bloquear pantalla.
 *  - Manteniendo un singleton `<audio>` con `audio.src = nuevaUrl` resolvemos
 *    el problema raíz de "no continúa la siguiente canción con pantalla bloqueada".
 *
 * Implementa la misma interfaz que el backend anterior para que `use-player.js`
 * no requiera cambios estructurales.
 */

/** Crea el `<audio>` singleton montado en el DOM y devuelve el backend. */
export function createHtmlAudioBackend() {
  /** @type {HTMLAudioElement|null} */
  let audio = null;
  /** @type {Set<() => void>} */
  const endedCbs = new Set();
  /** @type {Set<(p:number) => void>} */
  const posCbs = new Set();

  /** Activador del audioSession iOS 17+ y atributos críticos para background. */
  function ensureAudio() {
    if (audio) return audio;
    audio = document.createElement('audio');
    audio.preload = 'auto';
    // playsInline evita que Safari iOS lo trate como video y lo pause al bloquear.
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    audio.crossOrigin = 'anonymous';
    // Lo añadimos al DOM (oculto). Algunos navegadores son más permisivos con
    // elementos en el árbol que con elementos detached.
    audio.style.display = 'none';
    document.body.appendChild(audio);

    audio.addEventListener('timeupdate', () => {
      for (const cb of posCbs) cb(audio.currentTime);
    });
    audio.addEventListener('ended', () => {
      for (const cb of endedCbs) cb();
    });
    // iOS 17+: declarar la sesión de audio como "playback" → permite seguir
    // sonando con pantalla bloqueada y con el switch silencio activo.
    try {
      if ('audioSession' in navigator) {
        // @ts-ignore – API experimental no tipada
        navigator.audioSession.type = 'playback';
      }
    } catch {}
    return audio;
  }

  return {
    /** Inicializa el `<audio>` ya — debe llamarse durante un gesto de usuario. */
    init() { ensureAudio(); },

    /** Devuelve el elemento (para MediaSession positionState, etc.) */
    element() { return audio; },

    /** @param {string} url */
    load(url) {
      const el = ensureAudio();
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
        // Asignar src reusando el mismo elemento es la clave para iOS background.
        el.src = url;
        el.load();
      });
    },

    /**
     * Cambio SÍNCRONO de src + play, pensado para llamarse dentro del evento
     * `ended` original. iOS solo respeta la sesión activa si el siguiente
     * play() ocurre dentro del mismo task del evento `ended` previo, sin
     * await intermedios. Esta función no devuelve promise para no romper
     * el contexto del gesto.
     * @param {string} url
     */
    swapAndPlay(url) {
      const el = ensureAudio();
      el.src = url;
      el.load();
      // play() devuelve Promise pero la disparamos SIN await — iOS lo permite
      // porque el contexto del evento `ended` está activo.
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    },

    async play() {
      const el = ensureAudio();
      try { await el.play(); } catch (err) {
        // En iOS un play fuera de gesto puede fallar con NotAllowedError;
        // dejamos que el caller actualice estado a "pausado".
        throw err;
      }
    },

    pause() { audio?.pause(); },

    seek(sec) { if (audio) audio.currentTime = sec; },

    setVolume(v) { if (audio) audio.volume = Math.max(0, Math.min(1, v)); },

    onEnded(cb) { endedCbs.add(cb); return () => endedCbs.delete(cb); },
    onPosition(cb) { posCbs.add(cb); return () => posCbs.delete(cb); },

    duration() { return audio?.duration ?? 0; },

    dispose() {
      if (audio) {
        try { audio.pause(); } catch {}
        try { audio.removeAttribute('src'); audio.load(); } catch {}
        try { audio.remove(); } catch {}
        audio = null;
      }
      endedCbs.clear();
      posCbs.clear();
    },
  };
}
