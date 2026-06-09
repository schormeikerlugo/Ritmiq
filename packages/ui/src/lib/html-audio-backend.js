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

  // Listener global para auto-resume del AudioContext cuando la
  // ventana vuelve a foreground. Capa de defensa contra el bug
  // 'audio en silencio al minimizar desktop' \u2014 Electron/Chromium
  // suspende el AudioContext en background y el <audio> sigue
  // ticking pero sus muestras pasan por el graph que esta silenciado.
  //
  // Eventos cubiertos:
  //   visibilitychange visible \u2014 user vuelve a la pestana/ventana.
  //   focus           \u2014 user hace alt-tab a la ventana desktop.
  //   pageshow        \u2014 navegacion back/forward que reactiva la PWA.
  //
  // El closure captura ctx por referencia \u2014 cuando se cree mas
  // tarde en ensureGraphSync, el listener vera el nuevo valor.
  if (typeof document !== 'undefined') {
    const resumeIfNeeded = () => {
      if (!ctx) return;
      if (ctx.state === 'suspended' && audio && !audio.paused) {
        try { ctx.resume().catch(() => {}); } catch {}
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resumeIfNeeded();
    });
    window.addEventListener('focus', resumeIfNeeded);
    window.addEventListener('pageshow', resumeIfNeeded);
  }

  /**
   * Crea SINCRONICAMENTE el AudioContext + nodos + conexiones, y
   * dispara `resume()` sin await. Devuelve la Promise del resume para
   * que el caller pueda await DESPUES de que el resto del handler haya
   * disparado todo lo que necesita del gesto.
   *
   * CRITICO iOS PWA: si esta funcion se llama desde dentro de un
   * onClick directo (no de un wrapper async tras un await), iOS marca
   * el AudioContext como "user gesture validated" y el resume() lo
   * sacara de 'suspended' a 'running'. Si se llama tras un await el
   * gesto ya expiro → silencio total aunque el <audio> siga ticking.
   *
   * Idempotente: si ctx ya existe, solo redispara resume() si quedo
   * suspended (iOS lo revoca en background).
   *
   * @returns {Promise<AudioContext|null>|null} la promise del resume,
   *   o null si AudioContext API no esta disponible.
   */
  function ensureGraphSync() {
    if (ctx) {
      // Re-resume si quedo suspended. SIN await aqui — devolvemos la
      // promesa para que el caller la maneje si quiere.
      if (ctx.state === 'suspended') {
        try { return ctx.resume().then(() => ctx); } catch {}
      }
      return Promise.resolve(ctx);
    }
    const el = ensureAudio();
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();

      // Auto-resume si el ctx cae a 'suspended' mientras el <audio>
      // sigue reproduciendo. Pasa en Electron/Chromium cuando la
      // ventana se minimiza (background throttling). Sin este listener
      // los siguientes tracks suenan en silencio hasta que el usuario
      // trae la ventana a foreground.
      try {
        ctx.addEventListener('statechange', () => {
          if (ctx?.state === 'suspended' && audio && !audio.paused) {
            // El <audio> esta intentando reproducir pero el graph
            // esta silenciado. Resume sin await \u2014 fire and forget.
            try { ctx.resume().catch(() => {}); } catch {}
          }
        });
      } catch {}

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

      // CRITICO: resume SIN await dentro de la misma stack del gesto.
      // Devolvemos la promesa al caller; el resume se ejecuta paralelo
      // mientras el caller sigue con el resto del handler.
      try {
        return ctx.resume().then(() => ctx).catch(() => ctx);
      } catch {
        return Promise.resolve(ctx);
      }
    } catch (err) {
      console.warn('[audio-backend] WebAudio init failed', err?.message);
      ctx = null;
      return null;
    }
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
    // CRITICO WebAudio + iOS: para que MediaElementSource pueda leer las
    // muestras del audio (necesario para EQ, AnalyserNode/visualizers),
    // el <audio> debe ser cargado con CORS validado. Sin esto, WebKit
    // devuelve "MediaElementAudioSource outputs zeroes due to CORS
    // access restrictions" → silencio total cuando el graph esta activo.
    //
    // El server LAN ya devuelve Access-Control-Allow-Origin correcto, asi
    // que setear crossOrigin='anonymous' es seguro y no rompe la
    // reproduccion normal. DEBE setearse ANTES de cualquier src=...
    audio.crossOrigin = 'anonymous';
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

    /**
     * Prepara un track para arranque coordinado (Jam): carga la URL,
     * espera a tener audio listo (canplay), deja la posicion en 0 y NO
     * reproduce. Resuelve cuando el audio puede empezar a sonar — asi el
     * arranque posterior (playAfter) es inmediato y sin buffering.
     *
     * @param {string} url
     * @returns {Promise<void>}
     */
    prepareForSync(url) {
      const el = ensureAudio();
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch {}
      return new Promise((resolve, reject) => {
        const onReady = () => {
          cleanup();
          try { el.currentTime = 0; } catch {}
          resolve();
        };
        const onError = () => {
          cleanup();
          const code = el.error?.code ?? 0;
          reject(new Error(`audio prepare failed (code ${code})`));
        };
        const cleanup = () => {
          el.removeEventListener('canplay', onReady);
          el.removeEventListener('loadeddata', onReady);
          el.removeEventListener('error', onError);
        };
        el.addEventListener('canplay', onReady, { once: true });
        el.addEventListener('loadeddata', onReady, { once: true });
        el.addEventListener('error', onError, { once: true });
        el.src = url;
        revokeAllExcept(url);
        currentSrc = url;
      });
    },

    /**
     * Arranque diferido coordinado: reproduce desde la posicion actual
     * (0 si se llamo prepareForSync) tras `delayMs`. Devuelve un timer id
     * cancelable. Usado por el Jam para que todos arranquen a la vez.
     *
     * @param {number} delayMs
     * @returns {ReturnType<typeof setTimeout>}
     */
    playAfter(delayMs) {
      const el = ensureAudio();
      const ms = Math.max(0, Number(delayMs) || 0);
      if (ctx && ctx.state === 'suspended') {
        try { ctx.resume().catch(() => {}); } catch {}
      }
      return setTimeout(() => {
        const p = el.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }, ms);
    },

    async play() {
      const el = ensureAudio();
      // FIX bug audio mute en background:
      //
      // Sintoma: estando la ventana desktop minimizada, cuando termina un
      // track y carga el siguiente, suena en SILENCIO. Al traer la ventana
      // a foreground, vuelve el audio.
      //
      // Causa raiz: Chromium/Electron en background entra al AudioContext
      // en estado 'suspended' como parte del aggressive throttling. El
      // <audio> sigue ticking (timeupdate, ended) porque es HTMLMediaElement
      // independiente, pero sus muestras pasan por el WebAudio graph
      // (source \u2192 masterGain \u2192 analyser \u2192 destination). Con el ctx
      // suspended, ese graph silencia la salida.
      //
      // Fix: resume el ctx siempre antes de play(). Si no hay ctx aun,
      // no hay graph que activar \u2014 el <audio> va directo a la salida
      // del sistema (sin WebAudio en medio) y suena normal.
      if (ctx && ctx.state === 'suspended') {
        try { await ctx.resume(); } catch {}
      }
      await el.play();
    },

    pause() { audio?.pause(); },

    seek(sec) { if (audio) audio.currentTime = sec; },

    setVolume(v) { if (audio) audio.volume = Math.max(0, Math.min(1, v)); },

    // Ritmo de reproduccion. Usado por el sync de Jam para compensar drift
    // pequeno sin seeks audibles (0.97-1.03). Clamp defensivo.
    setRate(rate) {
      if (!audio) return;
      const r = Math.max(0.5, Math.min(2, Number(rate) || 1));
      audio.playbackRate = r;
    },

    onEnded(cb) { endedCbs.add(cb); return () => endedCbs.delete(cb); },
    onPosition(cb) { posCbs.add(cb); return () => posCbs.delete(cb); },

    duration() { return audio?.duration ?? 0; },

    /**
     * Cambio SINCRONO de src + play, pensado para llamarse dentro del
     * timeupdate (~0.4s antes del `ended` de la actual). Permite que iOS
     * conserve la autorizacion para reproducir en background.
     * Acepta URL HTTP o blob URL.
     *
     * IMPORTANTE: el resume() del ctx debe correr en paralelo (sin
     * await) porque esta funcion es sincrona y se llama desde un
     * timeupdate \u2014 no hay gesto del usuario que perder, pero el
     * await rompe el patron sincrono que permite a iOS preservar la
     * sesion de background.
     */
    swapAndPlay(url) {
      const el = ensureAudio();
      // Resume del ctx en paralelo. Sin esto, si la ventana esta
      // minimizada cuando se hace el swap, el siguiente track suena
      // en silencio (bug reportado en desktop). Ver play() para
      // explicacion detallada.
      if (ctx && ctx.state === 'suspended') {
        try { ctx.resume().catch(() => {}); } catch {}
      }
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
     * Inicializa el graph si no existe (async — debe llamarse desde
     * dentro de un gesto del usuario en iOS PWA). Retorna el
     * AnalyserNode listo para .getByteFrequencyData() etc.
     *
     * SI el graph aun no esta creado, devuelve null sin forzar init —
     * el caller decide si conviene crearlo (ver initGraphFromGesture).
     */
    getAnalyser() {
      return analyser;
    },

    /**
     * Retorna el GainNode master. null si el graph no esta inicializado.
     */
    getMasterGain() {
      return masterGain;
    },

    /** Devuelve si el AudioContext esta listo + el estado. */
    audioContextState() {
      return ctx?.state ?? 'inactive';
    },

    /**
     * Inicializa el graph DESDE UN GESTO DEL USUARIO. Critico iOS PWA.
     *
     * IMPORTANTE: esta funcion crea TODO sincronicamente y dispara
     * resume() en la misma stack. Devuelve la Promise del resume para
     * que el caller la pueda await DESPUES. Asi iOS valida el gesto
     * cuando el evento aun esta vivo, y el await no rompe el contrato.
     *
     * Patron correcto (handler de onClick):
     *
     *   const onClickToggle = () => {
     *     // 1) Dispara la creacion + resume EN LA MISMA STACK del click.
     *     const p = backend.initGraphFromGesture();
     *     // 2) Ya puedes esperar el resume sin problemas — el gesto
     *     //    fue capturado en el paso 1.
     *     p.then(running => {
     *       if (running) backend.setEqEnabled(true);
     *     });
     *   };
     *
     * @returns {Promise<boolean>} true si el graph quedo running.
     */
    initGraphFromGesture() {
      const p = ensureGraphSync();
      if (!p) return Promise.resolve(false);
      return p.then(() => ctx?.state === 'running');
    },

    /**
     * Resume el AudioContext (necesario en iOS tras gesto). No-op si
     * el graph aun no existe (no fuerza creacion).
     */
    async resumeContext() {
      if (!ctx) return;
      try {
        if (ctx.state === 'suspended') await ctx.resume();
      } catch {}
    },

    /**
     * Activa o desactiva el EQ. Cuando se desactiva, los filtros se
     * desconectan del graph (bypass total — cero overhead). Cuando se
     * activa, los filtros se insertan en la chain. Si el graph aun
     * NO existe y enabled=false, no se inicializa (no-op).
     *
     * IMPORTANTE: si enabled=true y el graph no existe, no se crea
     * automaticamente desde aqui — el caller debe haber llamado
     * initGraphFromGesture() previamente dentro de un onClick.
     *
     * @param {boolean} enabled
     */
    setEqEnabled(enabled) {
      eqEnabled = !!enabled;
      if (!ctx) return; // sin graph, nada que reconectar
      connectChain();
    },

    /**
     * Aplica ganancias a las 6 bandas de EQ. Acepta un array de 6
     * numeros en rango [-12, +12] dB. Valores fuera de rango se
     * clampean. No-op si el graph no esta inicializado.
     *
     * @param {number[]} gainsDb
     */
    setEqGains(gainsDb) {
      if (!ctx || !Array.isArray(gainsDb)) return;
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

    /** True si el WebAudio graph esta inicializado. Para que la UI
     *  sepa si puede aplicar EQ inmediato o si necesita un gesto. */
    isGraphReady() {
      return !!ctx;
    },
  };
}
