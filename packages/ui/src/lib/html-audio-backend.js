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
 *
 * WebAudio graph (LAZY):
 *  - El graph (AudioContext + MediaElementSource + GainNode + AnalyserNode +
 *    BiquadFilters de EQ) se crea SOLO cuando alguien llama a `ensureGraph()`.
 *    Esto es deliberado: una vez creas MediaElementSource(audio), el audio
 *    del <audio> deja de ir directo a output y pasa siempre por el graph.
 *    Si el usuario nunca activa EQ ni visualizer, evitamos overhead y
 *    cualquier riesgo de regresion en iOS background playback.
 *
 *  - Topologia:
 *
 *      <audio> --MediaElementSource--> master(Gain) --+--> Analyser --+--> destination
 *                                                     |               |
 *                                                     +--> EQ chain --+
 *
 *  - `setEqEnabled(bool)` y `setEqGains(number[])` para EQ por bandas.
 *  - `getAnalyser()` para BPM viz (F2.17) y otros visualizers.
 *  - `getMasterGain()` para crossfade futuro (F2.8) si usamos 2 backends.
 */

/** Cache de blob URLs creados para revocarlos al cambiar. */
const liveBlobUrls = new Set();

/**
 * Bandas del ecualizador. Frecuencias clasicas de EQ grafico de 6 bandas:
 * sub-bass, bass, low-mid, mid, high-mid, treble. Tipos lowshelf en los
 * extremos para que el control sea natural, peaking en el medio.
 */
export const EQ_BANDS = [
  { freq: 60,    type: 'lowshelf',  q: 1.0,  label: '60' },
  { freq: 170,   type: 'peaking',   q: 1.0,  label: '170' },
  { freq: 400,   type: 'peaking',   q: 1.0,  label: '400' },
  { freq: 1000,  type: 'peaking',   q: 1.0,  label: '1k' },
  { freq: 3500,  type: 'peaking',   q: 1.0,  label: '3.5k' },
  { freq: 10000, type: 'highshelf', q: 1.0,  label: '10k' },
];

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

  // ── WebAudio graph (lazy) ───────────────────────────────────────────
  /** @type {AudioContext|null} */
  let ctx = null;
  /** @type {MediaElementAudioSourceNode|null} */
  let source = null;
  /** @type {GainNode|null} */
  let masterGain = null;
  /** @type {AnalyserNode|null} */
  let analyser = null;
  /** @type {BiquadFilterNode[]} */
  let eqFilters = [];
  let eqEnabled = false;

  /**
   * Inicializa el AudioContext y conecta el graph. Lazy — solo se llama
   * si el caller necesita EQ, analyser o crossfade. Idempotente.
   *
   * En iOS WebKit el AudioContext arranca 'suspended' hasta que un gesto
   * del usuario lo resume — esto ya esta garantizado por el usePlayerEngine
   * que arranca tras el primer click/tap, asi que aqui solo lo llamamos
   * resume() por si acaso.
   */
  function ensureGraph() {
    if (ctx) return ctx;
    const el = ensureAudio();
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      source = ctx.createMediaElementSource(el);

      masterGain = ctx.createGain();
      masterGain.gain.value = 1;

      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;

      // Construye la cadena de filtros EQ una sola vez. Por defecto
      // todos a gain=0 (bypass aural — los filtros estan en la chain
      // pero no modifican el sonido hasta que el user toque un slider).
      eqFilters = EQ_BANDS.map((b) => {
        const f = ctx.createBiquadFilter();
        f.type = b.type;
        f.frequency.value = b.freq;
        f.Q.value = b.q;
        f.gain.value = 0;
        return f;
      });

      // Conexion: source → masterGain → [chain segun eqEnabled] → analyser → dest
      // Reconectamos en setEqEnabled.
      source.connect(masterGain);
      connectChain();

      // Resume si esta suspended (iOS).
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch (err) {
      console.warn('[audio-backend] WebAudio init failed', err?.message);
      ctx = null;
    }
    return ctx;
  }

  /** Reconecta la cadena segun eqEnabled. */
  function connectChain() {
    if (!ctx || !masterGain || !analyser) return;
    try { masterGain.disconnect(); } catch {}
    for (const f of eqFilters) { try { f.disconnect(); } catch {} }
    try { analyser.disconnect(); } catch {}

    if (eqEnabled && eqFilters.length > 0) {
      // masterGain → EQ[0] → EQ[1] → ... → analyser → destination
      masterGain.connect(eqFilters[0]);
      for (let i = 0; i < eqFilters.length - 1; i++) {
        eqFilters[i].connect(eqFilters[i + 1]);
      }
      eqFilters[eqFilters.length - 1].connect(analyser);
    } else {
      // masterGain → analyser → destination (EQ bypass)
      masterGain.connect(analyser);
    }
    analyser.connect(ctx.destination);
  }

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
      // CRITICO Safari/iOS: si asignamos `src` directamente mientras hay
      // Range requests en vuelo del track anterior, el decoder de iOS puede
      // entrar en estado corrupto y disparar code 3 (MEDIA_ERR_DECODE)
      // intermitente — sintoma clasico: "escucho unos segundos de la
      // anterior, hago click en otra y rompe". El reset (pause +
      // removeAttribute + load) le indica al elemento "olvidate de todo,
      // empezamos de cero" antes de asignar la nueva src.
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch {}
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
      // WebAudio cleanup. Disconnect + close — solo si el graph existe.
      try { source?.disconnect(); } catch {}
      try { masterGain?.disconnect(); } catch {}
      try { analyser?.disconnect(); } catch {}
      for (const f of eqFilters) { try { f.disconnect(); } catch {} }
      try { ctx?.close(); } catch {}
      ctx = null; source = null; masterGain = null; analyser = null;
      eqFilters = []; eqEnabled = false;
    },

    // ── WebAudio API publica ─────────────────────────────────────────

    /**
     * Inicializa el graph si no existe. Retorna el AnalyserNode listo
     * para .getByteFrequencyData() etc. Usar para visualizers (F2.17).
     */
    getAnalyser() {
      ensureGraph();
      return analyser;
    },

    /**
     * Retorna el GainNode master. Util para crossfade externo si
     * implementamos dual-backend (F2.8 v2). El volumen del store player
     * sigue usando audio.volume; este gain es independiente y aplica
     * sobre el graph completo.
     */
    getMasterGain() {
      ensureGraph();
      return masterGain;
    },

    /** Devuelve si el AudioContext esta listo + el estado. */
    audioContextState() {
      return ctx?.state ?? 'inactive';
    },

    /** Resume el AudioContext (necesario en iOS tras gesto). */
    resumeContext() {
      try {
        if (ctx?.state === 'suspended') return ctx.resume();
      } catch {}
      return Promise.resolve();
    },

    /**
     * Activa o desactiva el EQ. Cuando se desactiva, los filtros se
     * desconectan del graph (bypass total — cero overhead). Cuando se
     * activa, se vuelven a insertar entre masterGain y analyser.
     *
     * @param {boolean} enabled
     */
    setEqEnabled(enabled) {
      ensureGraph();
      eqEnabled = !!enabled;
      connectChain();
    },

    /**
     * Aplica ganancias a las 6 bandas de EQ. Acepta un array de 6
     * numeros en rango [-12, +12] dB. Valores fuera de rango se
     * clampean. Si el array es corto, las bandas faltantes quedan en 0.
     *
     * @param {number[]} gainsDb
     */
    setEqGains(gainsDb) {
      ensureGraph();
      if (!Array.isArray(gainsDb)) return;
      for (let i = 0; i < eqFilters.length; i++) {
        const g = Number(gainsDb[i]);
        const clamped = Number.isFinite(g) ? Math.max(-12, Math.min(12, g)) : 0;
        try { eqFilters[i].gain.value = clamped; } catch {}
      }
    },

    /** Retorna el estado actual del EQ (enabled + gains). */
    getEqState() {
      return {
        enabled: eqEnabled,
        gains: eqFilters.map((f) => f.gain.value),
      };
    },
  };
}
