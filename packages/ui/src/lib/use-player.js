/**
 * Hook que vincula la store de Zustand con el backend de audio (HTMLAudioElement
 * singleton) + MediaSession API completa para controles en lockscreen / AirPods
 * y reproducción continua con pantalla bloqueada.
 *
 * Claves para que iOS no pause la sesión al bloquear pantalla:
 *  1. Un único `<audio>` reutilizado en toda la sesión (no Howler).
 *  2. Unlock con play() muteado dentro del primer gesto del usuario.
 *  3. MediaSession con prev/next registrados ANTES del primer play().
 *  4. Pre-resolución de la URL del siguiente track + swap SÍNCRONO en `ended`.
 *  5. setPositionState con la duración del METADATA del track (no del <audio>,
 *     que puede ser Infinity al stremear y hace que iOS muestre controles de
 *     "live stream" en vez de prev/next).
 */

import { useEffect, useRef } from 'react';
import { resolveAudioSource } from '@ritmiq/core';
import { createHtmlAudioBackend } from './html-audio-backend.js';
import { usePlayerStore } from '../stores/player.js';
import { useHistoryStore } from '../stores/history.js';
import { useJamStore } from '../stores/jam.js';
import { useSettingsStore } from '../stores/settings.js';
import { api, isDesktop } from './api.js';
import { isEphemeralTrack } from './track-helpers.js';
import { supabase } from './supabase.js';
import {
  getLanBaseUrlSync, pingLan, getTunnelUrlSync, withTokenInUrl,
  getSignedStreamUrl, getServerUrlSync,
} from './lan-client.js';
import { getLocalBlobUrl, getJamBlobUrl, cacheJamTrack } from './local-downloads.js';

/**
 * Telemetria de orígenes de stream — singleton in-memory. Cuenta cuantas
 * reproducciones de la sesion actual se sirvieron desde cada origen del
 * cascade de resolveAudioSource. Sirve para que DiagnosticsSection
 * exhiba al usuario el reparto local vs LAN vs cache global vs cloud
 * — hace tangible el beneficio del cache global compartido.
 *
 * Solo cuenta el TRACK ACTUAL (no las precargas del siguiente — esas
 * podrian no llegar a sonar nunca).
 *
 * Se exporta para que la UI lo consulte; no se persiste entre arranques.
 *
 * @type {Record<string, number>}
 */
export const streamOriginCounts = {
  'local-file': 0,
  'local-blob': 0,
  'lan': 0,
  'cache-global-url': 0,
  'cloud-stream': 0,
};

/** @type {{ origin: string|null, at: number|null }} */
export const lastStreamOrigin = { origin: null, at: null };

function recordStreamOrigin(origin) {
  if (!origin) return;
  if (origin in streamOriginCounts) streamOriginCounts[origin]++;
  else streamOriginCounts[origin] = 1;
  lastStreamOrigin.origin = origin;
  lastStreamOrigin.at = Date.now();
}

/**
 * Dedupe set para no spamear publish-track-meta con el mismo ytId
 * en la misma sesion. El rate-limit del Edge ya protege a 100/min, pero
 * esto es buen comportamiento del cliente: 1 publish por ytId por sesion.
 *
 * Se limpia al recargar la app (es solo memoria de la sesion).
 */
const publishedMetaInSession = new Set();

/**
 * Estado observable de la ultima publicacion de metadata para mostrar
 * en Diagnostics. NO se persiste — solo memoria de la sesion.
 */
export const metaPublishStats = {
  attempts: 0,
  successes: 0,
  failures: 0,
  lastSuccessAt: null,
  lastError: null,
  knownInRitmiq: null, // count del diccionario global (refrescado en Diagnostics).
};

/**
 * Publica metadata del track al diccionario global tracks_global.
 * Fire-and-forget: no afecta latencia de reproduccion.
 *
 * Llamado tras backend.play() exitoso (= reproduccion REAL confirmada),
 * NO durante la fase de load — asi solo entran al diccionario tracks
 * que efectivamente sonaron, evitando contaminar con metadata de
 * resultados de busqueda nunca escuchados.
 *
 * @param {import('@ritmiq/core').Track} track
 */
async function publishTrackMeta(track) {
  if (!track?.ytId) return;
  if (!track.title || !track.artist) return;
  if (publishedMetaInSession.has(track.ytId)) return;
  publishedMetaInSession.add(track.ytId);

  const sup = import.meta.env.VITE_SUPABASE_URL;
  const apikey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!sup || !apikey) return;

  metaPublishStats.attempts++;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      // Sin sesion no podemos contribuir. Quitamos del set para que
      // si el user logea despues, el siguiente play del mismo track
      // si intente publicar.
      publishedMetaInSession.delete(track.ytId);
      return;
    }
    const res = await fetch(`${sup}/functions/v1/publish-track-meta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey,
      },
      body: JSON.stringify({
        ytId: track.ytId,
        title: track.title,
        artist: track.artist,
        album: track.album ?? null,
        coverUrl: track.coverUrl ?? null,
        durationSeconds: typeof track.durationSeconds === 'number'
          ? track.durationSeconds
          : null,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
    }
    metaPublishStats.successes++;
    metaPublishStats.lastSuccessAt = Date.now();
  } catch (err) {
    metaPublishStats.failures++;
    metaPublishStats.lastError = {
      message: String(err?.message ?? err).slice(0, 200),
      at: Date.now(),
    };
    // Quitamos del set para reintentar en proximo play del mismo track.
    publishedMetaInSession.delete(track.ytId);
  }
}

/**
 * Devuelve la duración "real" a usar para barra de progreso y pre-end swap.
 *
 * Algunas respuestas de googlevideo vía Cloudflare Tunnel reportan a Safari
 * una duración inflada (típicamente 2-3x la real) — el `<audio>` recibe el
 * stream chunked y computa duration por bitrate ~= bytes/seg, con fragmentos
 * DASH que confunden el cálculo. En esos casos `audio.duration` es finito
 * pero MAYOR que `track.durationSeconds` (que viene de yt-dlp y es la
 * duración real del video). Tomamos la metadata como ground truth cuando
 * `audio.duration` la excede por más de 10%.
 *
 * @param {number} audioDur  audio.duration del elemento HTMLAudioElement
 * @param {number} metaDur   track.durationSeconds desde metadata
 * @returns {number} duración efectiva (segundos) o 0 si no determinable
 */
function effectiveDuration(audioDur, metaDur) {
  const m = Number.isFinite(metaDur) && metaDur > 0 ? metaDur : 0;
  const a = Number.isFinite(audioDur) && audioDur > 0 ? audioDur : 0;
  if (m > 0 && a > 0) {
    // Si audio.duration excede metadata por más de 10%, asumimos que es
    // un cálculo inflado del proxy/Range y usamos la metadata como verdad.
    if (a > m * 1.10) return m;
    // Si audio.duration es notablemente MENOR (ej. la metadata era estimada),
    // confiamos en el audio que ya empezó a decodificar.
    return a;
  }
  return m || a || 0;
}

/* ── Cache de reachability LAN/Tunnel/Servidor para no martillar pings ── */
/** @type {{value:string|null, until:number}} */
let cachedReachable = { value: null, until: 0 };
const REACHABLE_TTL = 30_000;

/**
 * Último endpoint resuelto, para que la UI muestre a qué está conectado.
 * @type {{ url:string|null, kind:'lan'|'desktop'|'server'|null, at:number }}
 */
export const lastActiveEndpoint = { url: null, kind: null, at: 0 };

/**
 * Candidatos de endpoint disponibles hoy:
 *   - lan     → base URL local descubierta (misma WiFi que el desktop)
 *   - desktop → túnel Cloudflare del desktop
 *   - server  → túnel del servidor casero 24/7
 * @returns {Array<{ url:string, kind:'lan'|'desktop'|'server', timeout:number }>}
 */
function endpointCandidates() {
  const out = [];
  const lan = getLanBaseUrlSync();
  const desktop = getTunnelUrlSync();
  const server = getServerUrlSync();
  if (lan) out.push({ url: lan, kind: 'lan', timeout: 1200 });
  if (desktop) out.push({ url: desktop, kind: 'desktop', timeout: 2500 });
  if (server) out.push({ url: server, kind: 'server', timeout: 2500 });
  return out;
}

/** Ordena los candidatos según el modo de servidor elegido por el usuario. */
function orderCandidates(cands, mode) {
  const rank = (c) => {
    if (mode === 'prefer-server') {
      // servidor 24/7 primero, luego local/desktop
      return c.kind === 'server' ? 0 : c.kind === 'lan' ? 1 : 2;
    }
    // 'auto' (y fallback): desktop local (LAN) primero, luego desktop túnel,
    // y el servidor 24/7 como respaldo.
    return c.kind === 'lan' ? 0 : c.kind === 'desktop' ? 1 : 2;
  };
  return cands.slice().sort((a, b) => rank(a) - rank(b));
}

async function getReachableCached() {
  const now = Date.now();
  if (cachedReachable.until > now) return cachedReachable.value;

  let mode = 'auto';
  try {
    const { useSettingsStore } = await import('../stores/settings.js');
    mode = useSettingsStore.getState().serverMode ?? 'auto';
  } catch {}

  const cands = endpointCandidates();
  let winner = null;

  if (cands.length === 0) {
    winner = null;
  } else if (mode === 'fastest') {
    // Carrera: gana el primero que responda OK.
    winner = await new Promise((resolve) => {
      let remaining = cands.length;
      let resolved = false;
      for (const c of cands) {
        pingLan(c.url, c.timeout).then((ok) => {
          if (resolved) return;
          if (ok) { resolved = true; lastActiveEndpoint.kind = c.kind; resolve(c.url); return; }
          if (--remaining === 0) resolve(null);
        }).catch(() => { if (!resolved && --remaining === 0) resolve(null); });
      }
    });
  } else {
    // 'auto' / 'prefer-server': probar por prioridad, secuencial (el primero
    // sano gana). Secuencial evita conmutar de endpoint por jitter de red.
    const ordered = orderCandidates(cands, mode);
    for (const c of ordered) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await pingLan(c.url, c.timeout);
      if (ok) { winner = c.url; lastActiveEndpoint.kind = c.kind; break; }
    }
  }

  if (winner) { lastActiveEndpoint.url = winner; lastActiveEndpoint.at = now; }
  else { lastActiveEndpoint.url = null; lastActiveEndpoint.kind = null; }

  cachedReachable = { value: winner, until: now + REACHABLE_TTL };
  return winner;
}

/** Invalidar la cache cuando cambia conectividad o el modo de servidor. */
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { cachedReachable.until = 0; });
  window.addEventListener('offline', () => { cachedReachable = { value: null, until: Date.now() + 5_000 }; });
  window.addEventListener('ritmiq:server-mode-changed', () => { cachedReachable.until = 0; });
}

/* ── Resolver de URL compartido entre track actual y precarga ─────────── */
/**
 * @param {any} track
 */
/**
 * Resuelve una URL LOCAL de arranque instantáneo para `track`, SOLO si está
 * descargado. Es lo que permite el crossfade real (segundo audio que empieza
 * sin buffering). Devuelve null si no está disponible localmente.
 *
 *  - PWA: blob URL de IndexedDB (`getLocalBlobUrl`, cacheado en memoria).
 *  - Desktop: URL del servidor LAN local (http://127.0.0.1) que sirve el
 *    archivo descargado — arranque rápido sin red externa.
 *
 * @param {any} track
 * @returns {Promise<string|null>}
 */
async function resolveLocalUrl(track) {
  if (!track || !track.isDownloaded) return null;
  if (isEphemeralTrack(track)) return null;
  try {
    if (!isDesktop) {
      // PWA: blob real de la descarga.
      const blobUrl = await getLocalBlobUrl(track.id);
      return blobUrl || null;
    }
    // Desktop: archivo local servido por el LAN server.
    const info = await api.appInfo();
    if (!info?.lanPort) return null;
    const base = `http://127.0.0.1:${info.lanPort}`;
    const ytQs = track.ytId ? `?yt=${encodeURIComponent(track.ytId)}` : '';
    return withTokenInUrl(`${base}/stream/${encodeURIComponent(track.id)}${ytQs}`);
  } catch {
    return null;
  }
}

/**
 * ¿Es seguro hacer crossfade real ahora?
 *  - Foreground (la pestaña/ventana visible): en background/lockscreen iOS
 *    el doble elemento es frágil → caemos al swap afinado actual.
 *  - Sin WebAudio graph activo (EQ/visualizer): el graph enruta solo un
 *    elemento; con él activo el crossfade real no aplica.
 *  - Fuera de Jam (lo controla el handshake coordinado).
 *
 * @param {ReturnType<typeof createHtmlAudioBackend>} backend
 * @returns {boolean}
 */
function canCrossfade(backend) {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
  if (backend.isGraphReady && backend.isGraphReady()) return false;
  if (useJamStore.getState().mode !== 'idle') return false;
  return true;
}

function buildResolveDeps(track) {
  const ephemeral = isEphemeralTrack(track);
  return {
    getLocalUrl: async () => {
      if (!isDesktop && !ephemeral) {
        // 1) Descarga REAL del usuario (audioBlobs).
        const blobUrl = await getLocalBlobUrl(track.id);
        if (blobUrl) return blobUrl;
        // 2) Cache EFÍMERA del jam (jamCache, por ytId): reproducción local
        //    sin buffering aunque el track no esté descargado de verdad.
        if (track.ytId) {
          const jamUrl = await getJamBlobUrl(track.ytId);
          if (jamUrl) return jamUrl;
        }
      }
      return null;
    },
    getLanBaseUrl: async () => {
      if (isDesktop && ephemeral) return null;
      if (isDesktop) {
        const info = await api.appInfo();
        return info?.lanPort ? `http://127.0.0.1:${info.lanPort}` : null;
      }
      return getReachableCached();
    },
    buildLanStreamUrl: (trackId, base) => {
      // Modelo Y: si esta PWA esta pareada, getAccessTokenSync devuelve
      // device_token y construimos URL directa con ?yt=<ytId> para que el
      // desktop encuentre shared_audio aunque el track no este en su
      // SQLite local. Si NO esta pareada, intentamos sign-stream (HMAC)
      // y caemos a Bearer-token compat.
      const ytQs = track.ytId ? `?yt=${encodeURIComponent(track.ytId)}` : '';
      if (isDesktop) {
        return withTokenInUrl(`${base}/stream/${encodeURIComponent(trackId)}${ytQs}`);
      }
      // PWA: si hay device_token o access_token en localStorage, ir directo.
      // El desktop usa authorizeDeviceOrOwner para validar.
      let hasLocalToken = false;
      try { hasLocalToken = !!(localStorage.getItem('ritmiq:device:token') || localStorage.getItem('ritmiq:lan:accessToken')); } catch {}
      if (hasLocalToken) {
        return withTokenInUrl(`${base}/stream/${encodeURIComponent(trackId)}${ytQs}`);
      }
      // Sin token local: pedimos firma HMAC al Edge sign-stream.
      return getSignedStreamUrl(trackId, base).then((signed) => {
        if (signed) {
          // Conservamos ?yt=<ytId> incluso con firma para que el desktop
          // pueda hacer cache HIT por ytId sin ir a Supabase.
          if (track.ytId && !signed.includes('yt=')) {
            const sep = signed.includes('?') ? '&' : '?';
            return `${signed}${sep}yt=${encodeURIComponent(track.ytId)}`;
          }
          return signed;
        }
        return withTokenInUrl(`${base}/stream/${encodeURIComponent(trackId)}${ytQs}`);
      });
    },
    // FASE 1 CACHE GLOBAL: lookup en stream_url_cache. Si otro desktop
    // ya resolvio este ytId con yt-dlp, lo reusamos sin tocar Edge
    // resolve-stream. Latencia ~50-100ms vs 1-3s del fallback. Si falla
    // (sin red, sin sesion, sin Edge deployed), audio-source.js cae
    // transparente al siguiente paso. Cero regresion.
    getGlobalCachedUrl: async (ytId) => {
      if (!ytId) return null;
      const sup = import.meta.env.VITE_SUPABASE_URL;
      if (!sup) return null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return null;
        const r = await fetch(
          `${sup}/functions/v1/get-stream-url?ytId=${encodeURIComponent(ytId)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    },
    // CONTEXTO HISTÓRICO: aquí vivía `getDirectStreamUrl` que pedía la URL
    // firmada directa de googlevideo al lan-server. Se removió porque
    // googlevideo IP-locked rechaza al iPhone con 403 → fallback doblaba
    // round-trips. Ver `audio-source.js` y `lan-client.js` para más detalle.
    resolveCloudStream: async () => {
      if (isDesktop && track.ytId) {
        const url = await api.ytStreamUrl(track.ytId);
        return { url };
      }
      if (track.ytId) {
        const base = import.meta.env.VITE_SUPABASE_URL;
        const apikey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!base) throw new Error('Supabase URL no configurado');
        const url =
          `${base}/functions/v1/resolve-stream?ytId=${encodeURIComponent(track.ytId)}&proxy=1` +
          (apikey ? `&apikey=${encodeURIComponent(apikey)}` : '');
        return { url };
      }
      throw new Error('Stream no disponible');
    },
  };
}

/**
 * Backend singleton expuesto para que componentes (NowPlaying BPM viz,
 * EQ UI, etc.) puedan accederlo sin pasar props. Inicializado por el
 * primer usePlayerEngine() — null antes de eso.
 * @type {ReturnType<typeof createHtmlAudioBackend>|null}
 */
let sharedBackend = null;

/** Devuelve el backend singleton, o null si el engine aun no monto. */
export function getSharedBackend() {
  return sharedBackend;
}

export function usePlayerEngine() {
  const backendRef = useRef(null);
  if (!backendRef.current) {
    backendRef.current = createHtmlAudioBackend();
    sharedBackend = backendRef.current;
  }
  const backend = backendRef.current;

  /** URL del siguiente track precargada, lista para swap síncrono en `ended`. */
  const nextUrlRef = useRef(null);
  /** Track al que corresponde nextUrlRef.current (para validar antes del swap). */
  const nextTrackRef = useRef(null);
  /**
   * URL LOCAL (blob: en PWA / http LAN en desktop) del siguiente track,
   * SOLO si está descargado. Es la fuente de arranque instantáneo para el
   * crossfade real (2 audios solapados). null si la siguiente no está
   * descargada → en ese caso no hay crossfade real (swap normal).
   */
  const nextLocalUrlRef = useRef(null);
  /** Id del track actualmente cargado en el <audio>. Evita doble load tras swap. */
  const loadedTrackIdRef = useRef(null);
  /**
   * Fingerprint del media actualmente cargado: `ytId` cuando existe, sino `id`.
   * Se mantiene estable cuando un track efímero (yt:<id>) se persiste y obtiene
   * un UUID nuevo — en ese caso el ytId NO cambia, así evitamos recargar el
   * audio (que reiniciaría la canción) tras "Guardar en biblioteca/playlist".
   */
  const loadedFingerprintRef = useRef(null);

  const setState = usePlayerStore((s) => s.patch);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);

  /* ── Unlock del <audio> en el primer gesto del usuario ──────────────── */
  useEffect(() => {
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      try {
        backend.init();
        // Desbloquea AMBOS elementos (activo + el 2º de crossfade) dentro
        // del gesto. Sin esto, crossfadeTo no puede reproducir el segundo
        // elemento y el fundido no se oye (solo baja la saliente).
        if (backend.unlockAll) backend.unlockAll();
        else {
          const el = backend.element();
          if (el) {
            const wasMuted = el.muted;
            el.muted = true;
            const p = el.play();
            if (p && typeof p.then === 'function') {
              p.then(() => { el.pause(); el.muted = wasMuted; })
               .catch(() => { el.muted = wasMuted; });
            } else {
              el.pause(); el.muted = wasMuted;
            }
          }
        }
      } catch {}
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('touchend', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, [backend]);

  /* ── MediaSession action handlers (una sola vez) ────────────────────── */
  // Importante: NO registramos seekbackward/seekforward porque iOS, al ver
  // ambos seek y prev/next registrados, prioriza los seek y muestra botones
  // de ±10s en vez de pista anterior/siguiente. Mantenemos solo seekto que
  // se usa por gesto en la barra de progreso del lockscreen.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const store = () => usePlayerStore.getState();

    // Registrar prev/next ANTES que play/pause — algunos reportes indican
    // que iOS lee el conjunto de handlers en orden de registro y necesita
    // que prev/next existan al asociar la sesión.
    ms.setActionHandler('previoustrack', () => store().prev());
    ms.setActionHandler('nexttrack',     () => store().next());
    ms.setActionHandler('play',  () => store().patch({ isPlaying: true }));
    ms.setActionHandler('pause', () => store().patch({ isPlaying: false }));
    // seekto es necesario para que el scrubber del lockscreen funcione.
    // iOS muestra prev/next + scrubber juntos si la duración es finita;
    // solo cae a ±10s si decide que es contenido "podcast".
    ms.setActionHandler('seekto', (d) => {
      if (d && typeof d.seekTime === 'number') backend.seek(d.seekTime);
    });
    try { ms.setActionHandler('stop', () => { backend.pause(); store().patch({ isPlaying: false }); }); } catch {}

    // Limpiar seek ±10s — esos sí compiten con prev/next por el espacio.
    try { ms.setActionHandler('seekbackward', null); } catch {}
    try { ms.setActionHandler('seekforward',  null); } catch {}

    return () => {
      for (const a of ['play','pause','previoustrack','nexttrack','seekto','stop']) {
        try { ms.setActionHandler(a, null); } catch {}
      }
    };
  }, [backend]);

  /* ── Posición → store + MediaSession.setPositionState ───────────────── */
  // Tracking de "play consumido" para recomendaciones. Marcamos un track
  // como reproducido cuando el usuario lleva >= 30 segundos efectivos O
  // >= 30% de la duración (lo que ocurra antes). Esto evita inflar el
  // historial con skips rápidos. Resetea cuando cambia currentTrack.
  const playConsumedRef = useRef({ trackFp: null, recorded: false });
  useEffect(() => {
    let lastPosUpdate = 0;
    return backend.onPosition((positionSeconds) => {
      const meta = usePlayerStore.getState().currentTrack;
      const metaDur = Number(meta?.durationSeconds) || 0;
      const audioDur = backend.duration();
      const dur = effectiveDuration(audioDur, metaDur);

      // Registrar en historial si supera el umbral. Solo una vez por track.
      if (meta) {
        const fp = meta.ytId || meta.id;
        const state = playConsumedRef.current;
        if (state.trackFp !== fp) {
          playConsumedRef.current = { trackFp: fp, recorded: false };
        }
        const threshold = Math.min(30, dur > 0 ? dur * 0.3 : 30);
        if (!playConsumedRef.current.recorded && positionSeconds >= threshold) {
          playConsumedRef.current.recorded = true;
          try {
            useHistoryStore.getState().record(meta, positionSeconds);
          } catch (e) {
            console.warn('[player] record play failed', e?.message);
          }
        }
      }
      // Sincronizar también durationSeconds en el store — la UI dibuja la
      // barra de progreso a partir de aquí, así nunca verá la duración
      // inflada del <audio>.
      const clampedPos = dur > 0 ? Math.min(positionSeconds, dur) : positionSeconds;
      setState({ positionSeconds: clampedPos, durationSeconds: dur });
      const now = performance.now();
      if (now - lastPosUpdate < 900) return;
      lastPosUpdate = now;
      try {
        if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
          if (dur > 0) {
            navigator.mediaSession.setPositionState({
              duration: dur,
              position: Math.min(clampedPos, dur),
              playbackRate: 1,
            });
          }
        }
      } catch {}
    });
  }, [backend, setState]);

  /* ── Pre-end swap: cambiar al siguiente ANTES de que `ended` dispare ── */
  // iOS Safari mantiene la autorización del `<audio>` para reproducir en
  // background SOLO mientras el elemento siga reproduciendo sin gap. El
  // evento `ended` ya está fuera de esa ventana → cualquier play() en
  // background falla silenciosamente. Por eso disparamos el swap a
  // duration - 0.4s, cuando el `<audio>` AÚN está en estado `playing`.
  const swapDoneRef = useRef(null); // id del track ya consumido (anti-dup)
  const xfadeDoneRef = useRef(null); // id del track cuyo crossfade ya inició
  useEffect(() => {
    return backend.onPosition((pos) => {
      const store = usePlayerStore.getState();
      const cur = store.currentTrack;
      if (!cur || !store.isPlaying) return;

      const audioDur = backend.duration();
      const metaDur = Number(cur.durationSeconds) || 0;
      const dur = effectiveDuration(audioDur, metaDur);
      if (!dur || dur < 2) return;

      const remaining = dur - pos;

      // ── CROSSFADE AUTOMÁTICO (real, 2 audios) ──────────────────────────
      // Si el usuario activó crossfade, la siguiente está DESCARGADA y es
      // seguro (foreground, sin EQ graph, sin jam, sin repeat-one, sin
      // shuffle), iniciamos el solape cuando faltan `xfade` segundos.
      const xfade = useSettingsStore.getState().crossfadeSeconds;
      if (
        xfade > 0 &&
        store.repeat !== 'one' &&
        !store.shuffle &&
        xfadeDoneRef.current !== cur.id &&
        swapDoneRef.current !== cur.id &&
        remaining > 0.4 &&
        remaining <= xfade &&
        canCrossfade(backend)
      ) {
        const nIdx = store.index + 1;
        const nTrack = store.queue[nIdx];
        const local = nextLocalUrlRef.current;
        if (typeof window !== 'undefined' && window.__ritmiqXfadeDebug) {
          console.log('[xfade-auto] trigger', { remaining: remaining.toFixed(2), xfade, hasLocal: !!local, nextId: nTrack?.id, localId: local?.id });
        }
        if (nTrack && local && local.id === nTrack.id) {
          xfadeDoneRef.current = cur.id;
          swapDoneRef.current = cur.id; // evita que el swap a 0.4s también dispare
          // Solapa: la entrante arranca y sube mientras la actual baja.
          backend.crossfadeTo(local.url, { seconds: Math.min(xfade, remaining) })
            .then(() => {
              loadedTrackIdRef.current = nTrack.id;
              loadedFingerprintRef.current = nTrack.ytId || nTrack.id;
              applyMediaSessionMetadata(nTrack);
              if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
              nextUrlRef.current = null;
              nextTrackRef.current = null;
              nextLocalUrlRef.current = null;
              usePlayerStore.getState().patch({
                index: nIdx,
                currentTrack: nTrack,
                isPlaying: true,
                positionSeconds: 0,
              });
            })
            .catch(() => {
              // Si el crossfade falla, deshacemos el anti-dup para que el
              // swap normal a 0.4s tome el relevo.
              xfadeDoneRef.current = null;
              swapDoneRef.current = null;
            });
          return;
        }
      }

      // Margen 0.4s — suficiente para que iOS lo trate como continuación.
      // Si audioDur estaba inflado pero metaDur es la verdad, este chequeo
      // dispara al final REAL de la canción y evita los minutos de silencio.
      if (remaining > 0.4) return;

      // Repeat one: reseek dentro del mismo elemento, NO swap.
      if (store.repeat === 'one') {
        if (swapDoneRef.current === cur.id + ':loop:' + Math.floor(pos)) return;
        swapDoneRef.current = cur.id + ':loop:' + Math.floor(pos);
        backend.seek(0);
        return;
      }

      // Evitar disparar el swap dos veces para el mismo track.
      if (swapDoneRef.current === cur.id) return;

      // JAM: el avance lo controla el HOST tomando la siguiente sugerencia
      // pendiente de jam_queue (FIFO), reproducida via arranque coordinado.
      // Los guests no avanzan por su cuenta (lo reciben sincronizado). Si no
      // hay sugerencias pendientes, se detiene limpiamente.
      const jam = useJamStore.getState();
      if (jam.mode !== 'idle') {
        swapDoneRef.current = cur.id;
        if (jam.mode === 'hosting') {
          jam.jamAdvance();
        }
        return;
      }

      const nextIdx = store.shuffle ? pickShuffleIdx(store) : store.index + 1;
      if (nextIdx < 0 || nextIdx >= store.queue.length) {
        // Fin de cola: dejar que termine naturalmente.
        return;
      }
      const nextTrack = store.queue[nextIdx];
      const preUrl = (nextTrackRef.current?.id === nextTrack.id) ? nextUrlRef.current : null;

      if (!preUrl) {
        // Precarga no lista. Si la duración EFECTIVA ya se alcanzó (la
        // canción real terminó, aunque el <audio> aún tenga "tail" con
        // silencio inflado), saltamos al siguiente en foreground para que
        // el usuario no oiga los minutos de silencio. En lockscreen iOS
        // bloqueará el play() async — limitación conocida del camino sin
        // precarga.
        if (remaining <= 0.05 && swapDoneRef.current !== cur.id + ':fallback') {
          swapDoneRef.current = cur.id + ':fallback';
          store.next();
        }
        return;
      }

      swapDoneRef.current = cur.id;

      // 1) Swap del audio MIENTRAS está reproduciendo (iOS conserva sesión).
      backend.swapAndPlay(preUrl);
      // 2) Marcar el nuevo track como cargado para que el useEffect que
      //    vigila currentTrack NO vuelva a hacer load() y rompa la sesión.
      loadedTrackIdRef.current = nextTrack.id;
      // 3) Metadata MediaSession para nueva canción.
      applyMediaSessionMetadata(nextTrack);
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      // 4) Sincronizar el store (React).
      nextUrlRef.current = null;
      nextTrackRef.current = null;
      store.patch({
        index: nextIdx,
        currentTrack: nextTrack,
        isPlaying: true,
        positionSeconds: 0,
      });
    });
  }, [backend]);

  /** @param {{queue:any[], index:number}} store */
  function pickShuffleIdx(store) {
    if (store.queue.length === 0) return -1;
    if (store.queue.length === 1) return 0;
    let n;
    do { n = Math.floor(Math.random() * store.queue.length); } while (n === store.index);
    return n;
  }

  // Reset de los flags anti-dup cuando cambia el track.
  useEffect(() => { swapDoneRef.current = null; xfadeDoneRef.current = null; }, [currentTrack]);

  /* ── Evento `ended` (fallback foreground / fin de cola) ─────────────── */
  useEffect(() => {
    return backend.onEnded(() => {
      const store = usePlayerStore.getState();
      if (store.repeat === 'one' && store.currentTrack) {
        backend.seek(0);
        backend.play().catch(() => {});
        return;
      }
      // En este punto el pre-end swap no se disparó (sin precarga lista o
      // fin de cola). Camino lento; en lockscreen iOS bloqueará el play().
      store.next();
    });
  }, [backend]);

  /* ── Aplicar volumen ────────────────────────────────────────────────── */
  useEffect(() => { backend.setVolume(volume); }, [backend, volume]);

  /* ── Listener para seek desde NowPlaying scrubber ───────────────────── */
  useEffect(() => {
    const onSeek = (ev) => {
      const sec = ev?.detail?.seconds;
      if (typeof sec === 'number') backend.seek(sec);
    };
    window.addEventListener('ritmiq:seek', onSeek);
    return () => window.removeEventListener('ritmiq:seek', onSeek);
  }, [backend]);

  /* ── Listener para set-rate (drift compensation de Jam) ─────────────── */
  useEffect(() => {
    const onSetRate = (ev) => {
      const rate = ev?.detail?.rate;
      if (typeof rate === 'number' && typeof backend.setRate === 'function') {
        backend.setRate(rate);
      }
    };
    window.addEventListener('ritmiq:set-rate', onSetRate);
    return () => window.removeEventListener('ritmiq:set-rate', onSetRate);
  }, [backend]);

  /* ── Jam: arranque coordinado (prepare → ready → start) ──────────────── */
  // El bridge de Jam (use-jam-sync) emite estos eventos. El player es quien
  // tiene acceso al backend de audio y al resolve de URL, asi que aqui:
  //   - 'ritmiq:jam-prepare': resolver+cargar el track SIN sonar, fijar el
  //     currentTrack en el store (para UI) y avisar "listo" via callback.
  //   - 'ritmiq:jam-start': arrancar la reproduccion tras startInMs.
  // Reutiliza buildResolveDeps (mismo cascade: local-blob/LAN/cache/cloud).
  const jamStartTimerRef = useRef(null);
  useEffect(() => {
    const onPrepare = async (ev) => {
      const { track, onReady } = ev?.detail ?? {};
      if (!track) return;
      try {
        // Marcar como "cargado por jam" para que el effect de currentTrack
        // no vuelva a hacer load() y rompa el arranque coordinado.
        setState({ error: null });
        const resolved = await resolveAudioSource(track, buildResolveDeps(track));
        await backend.prepareForSync(resolved.url);
        recordStreamOrigin(resolved.origin);
        // Auto-descarga efímera (PWA): si el audio no vino ya de un blob
        // local, guardarlo en jamCache por ytId en background para que la
        // PRÓXIMA reproducción de este track (re-entrar, saltar atrás) sea
        // local y sin buffering. No bloquea el arranque. TTL 1h + LRU.
        if (!isDesktop && track.ytId && resolved.origin !== 'local-blob' && resolved.url) {
          cacheJamTrack(track.ytId, resolved.url).catch(() => {});
        }
        loadedTrackIdRef.current = track.id;
        loadedFingerprintRef.current = track.ytId || track.id;
        // Reflejar en el store (UI) sin reproducir todavia.
        usePlayerStore.setState({
          currentTrack: track,
          queue: [track],
          index: 0,
          isPlaying: false,
          positionSeconds: 0,
        });
        applyMediaSessionMetadata(track);
        if (typeof onReady === 'function') onReady(null);
      } catch (err) {
        console.warn('[jam] prepare failed', err?.message);
        if (typeof onReady === 'function') onReady(err);
      }
    };
    const onStart = (ev) => {
      const startInMs = Number(ev?.detail?.startInMs) || 0;
      if (jamStartTimerRef.current) clearTimeout(jamStartTimerRef.current);
      jamStartTimerRef.current = backend.playAfter(startInMs);
      // Sincronizar el store al estado "sonando" cuando arranque.
      setTimeout(() => {
        usePlayerStore.setState({ isPlaying: true });
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      }, startInMs);
    };
    // Pre-prepare: resolver + cachear (en PWA) la SIGUIENTE sugerencia en
    // background, sin sonar, para que su prepare sea casi instantaneo. No
    // toca el audio actual; solo calienta la cache (jamCache por ytId) y la
    // precarga de URL del backend.
    const onPreprepare = async (ev) => {
      const track = ev?.detail?.track;
      if (!track) return;
      try {
        const resolved = await resolveAudioSource(track, buildResolveDeps(track));
        if (!isDesktop && track.ytId && resolved.origin !== 'local-blob' && resolved.url) {
          cacheJamTrack(track.ytId, resolved.url).catch(() => {});
        }
      } catch { /* best-effort */ }
    };
    window.addEventListener('ritmiq:jam-prepare', onPrepare);
    window.addEventListener('ritmiq:jam-start', onStart);
    window.addEventListener('ritmiq:jam-preprepare', onPreprepare);
    return () => {
      window.removeEventListener('ritmiq:jam-prepare', onPrepare);
      window.removeEventListener('ritmiq:jam-start', onStart);
      window.removeEventListener('ritmiq:jam-preprepare', onPreprepare);
      if (jamStartTimerRef.current) clearTimeout(jamStartTimerRef.current);
    };
  }, [backend, setState]);

  /* ── Track actual: cargar y reproducir ──────────────────────────────── */
  useEffect(() => {
    if (!currentTrack) return;
    const fp = currentTrack.ytId || currentTrack.id;

    // JAM: la carga/reproduccion en modo SYNC la controla el handshake
    // coordinado (eventos jam-prepare/jam-start), NO este effect. EXCEPCION:
    // el HOST en modo SPEAKER reproduce normal (es el altavoz) → dejamos que
    // este effect cargue/reproduzca como siempre.
    const jam = useJamStore.getState();
    const hostSpeaker = jam.mode === 'hosting' && jam.kind === 'speaker';
    if (jam.mode !== 'idle' && !hostSpeaker) {
      // Guest (cualquier modo) o host en sync: no auto-cargar aqui.
      if (loadedTrackIdRef.current !== currentTrack.id) {
        backend.pause();
      }
      return;
    }

    // ATAJO 1: el track ya fue cargado por el pre-end swap (timeupdate).
    if (loadedTrackIdRef.current === currentTrack.id) {
      loadedFingerprintRef.current = fp;
      applyMediaSessionMetadata(currentTrack);
      setState({ durationSeconds: backend.duration() });
      return;
    }

    // ATAJO 2: el track tiene el MISMO ytId que el cargado (solo cambió su
    // identidad lógica — típicamente porque un track efímero `yt:<id>` se
    // acaba de persistir y obtuvo un UUID nuevo). Mantenemos el audio
    // exactamente como está; solo sincronizamos el id y la metadata visual.
    // Sin esto, "Guardar en playlist" pausaría y reiniciaría la canción.
    if (fp && loadedFingerprintRef.current === fp) {
      loadedTrackIdRef.current = currentTrack.id;
      applyMediaSessionMetadata(currentTrack);
      return;
    }

    let cancelled = false;

    // ── CROSSFADE MANUAL (real, 2 audios) ───────────────────────────────
    // Si el usuario activó crossfade, venía sonando algo, el NUEVO track
    // está descargado y es seguro (foreground, sin EQ graph, sin jam),
    // solapamos en vez de cortar+recargar el único elemento.
    const xfade = useSettingsStore.getState().crossfadeSeconds;
    const wasPlaying = !!loadedTrackIdRef.current && usePlayerStore.getState().isPlaying;
    if (typeof window !== 'undefined' && window.__ritmiqXfadeDebug) {
      console.log('[xfade-manual] eval', { xfade, wasPlaying, canXfade: canCrossfade(backend), visible: (typeof document !== 'undefined' ? document.visibilityState : '?'), graphReady: backend.isGraphReady?.(), curId: currentTrack.id });
    }
    if (xfade > 0 && wasPlaying && canCrossfade(backend)) {
      loadedTrackIdRef.current = null;
      loadedFingerprintRef.current = null;
      applyMediaSessionMetadata(currentTrack);
      (async () => {
        try {
          setState({ error: null });
          const localUrl = await resolveLocalUrl(currentTrack);
          if (cancelled) return;
          if (!localUrl) {
            // Nuevo track no descargado → camino normal (corte + load).
            await loadAndPlayCurrent(currentTrack, fp, () => cancelled);
            return;
          }
          recordStreamOrigin(isDesktop ? 'lan' : 'local-blob');
          await backend.crossfadeTo(localUrl, { seconds: xfade });
          if (cancelled) return;
          loadedTrackIdRef.current = currentTrack.id;
          loadedFingerprintRef.current = fp;
          setState({ isPlaying: true, durationSeconds: backend.duration() });
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
          publishTrackMeta(currentTrack);
        } catch (err) {
          // Si el crossfade falla, caer al camino normal.
          if (cancelled) return;
          try { await loadAndPlayCurrent(currentTrack, fp, () => cancelled); } catch {}
        }
      })();
      return () => { cancelled = true; };
    }

    // Pausar inmediatamente el track anterior — evita la race condition con
    // el useEffect[isPlaying] que correría play() sobre el src viejo.
    backend.pause();
    // FIX BUG 3: limpiar refs ANTES del await. Sin esto, durante los 5-8s
    // del resolve+load del nuevo track, useEffect[isPlaying] ve el ref del
    // track ANTERIOR y puede llamar backend.play() sobre el src viejo —
    // sintoma: "el audio anterior sigue sonando unos segundos al cambiar".
    loadedTrackIdRef.current = null;
    loadedFingerprintRef.current = null;
    applyMediaSessionMetadata(currentTrack);

    loadAndPlayCurrent(currentTrack, fp, () => cancelled);

    return () => { cancelled = true; };

    /**
     * Camino normal: resuelve la URL, carga y reproduce el track actual
     * en el elemento activo. Compartido entre el flujo normal y el
     * fallback del crossfade.
     */
    async function loadAndPlayCurrent(track, fingerprint, isCancelled) {
      try {
        setState({ error: null });
        const resolved = await resolveAudioSource(track, buildResolveDeps(track));
        const { url } = resolved;
        if (isCancelled()) return;
        recordStreamOrigin(resolved.origin);
        await backend.load(url);
        if (isCancelled()) return;
        loadedTrackIdRef.current = track.id;
        loadedFingerprintRef.current = fingerprint;
        await backend.play();
        setState({ isPlaying: true, durationSeconds: backend.duration() });
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
        // Fire-and-forget: contribuir metadata al diccionario global
        // Ritmiq. Solo tras play() exitoso = reproduccion REAL. Dedupe
        // por sesion + ytId interno. NO bloquea ni afecta latencia.
        publishTrackMeta(track);
      } catch (err) {
        console.error('[player] load failed', err);
        setState({ isPlaying: false, error: String(err?.message ?? err) });
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      }
    }
  }, [currentTrack, backend, setState]);

  /* ── PRECARGA del siguiente track (solo resolver URL) ───────────────── */
  // Solo resolvemos la URL en background — no descargamos el archivo. Eso
  // mantiene el inicio de la canción ACTUAL rápido y el swap al siguiente
  // sigue siendo instantáneo: `audio.src = url` empieza a stremear al instante.
  useEffect(() => {
    nextUrlRef.current = null;
    nextTrackRef.current = null;
    nextLocalUrlRef.current = null;
    if (!currentTrack) return;
    const store = usePlayerStore.getState();
    if (store.shuffle) return;
    const nextIdx = index + 1;
    const nextTrack = queue[nextIdx];
    if (!nextTrack) return;

    let cancelled = false;
    // Delay reducido a 200ms (antes 1200ms): con `cookiesFile` cacheado y
    // MAX_CONCURRENT=3 en el LAN server, la resolución del siguiente NO
    // compite con la del track actual. Lanzarlo casi inmediatamente
    // multiplica las probabilidades de que el swap final sea instantáneo.
    const timer = setTimeout(async () => {
      try {
        // Precarga del siguiente: usar SIEMPRE proxy URL. El swap síncrono
        // (swapAndPlay) no tiene fallback si googlevideo rechaza con 403.
        const { url } = await resolveAudioSource(nextTrack, buildResolveDeps(nextTrack));
        if (cancelled) return;
        nextUrlRef.current = url;
        nextTrackRef.current = nextTrack;
      } catch (e) {
        nextUrlRef.current = null;
        nextTrackRef.current = null;
      }
      // Además, si el siguiente está DESCARGADO, pre-resolver su URL local
      // (blob/LAN) para el crossfade real — arranque instantáneo del 2º audio.
      try {
        const localUrl = await resolveLocalUrl(nextTrack);
        if (cancelled) return;
        nextLocalUrlRef.current = localUrl
          ? { id: nextTrack.id, url: localUrl }
          : null;
      } catch {
        nextLocalUrlRef.current = null;
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [currentTrack, queue, index, backend]);

  /* ── play/pause sync + playbackState ────────────────────────────────── */
  // CRÍTICO: solo actuar cuando el <audio> ya tiene cargado el track actual.
  // De otro modo, este effect podría llamar play() sobre el src VIEJO
  // mientras el useEffect[currentTrack] aún está async-cargando el nuevo —
  // causa de "elijo otra canción pero sigue sonando la anterior".
  useEffect(() => {
    if (!currentTrack) return;
    if (loadedTrackIdRef.current !== currentTrack.id) return;
    if (isPlaying) {
      backend.play().catch(() => setState({ isPlaying: false }));
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    } else {
      backend.pause();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    }
  }, [isPlaying, currentTrack, backend, setState]);

  return backend;
}

/**
 * Registra la metadata visible en lockscreen / Centro de control / AirPods,
 * y establece un positionState inicial usando la duración del METADATA del
 * track (no del <audio>, que puede ser Infinity al stremear). iOS decide el
 * layout del lockscreen en función de este positionState.
 *
 * @param {import('@ritmiq/core/types').Track} track
 */
function applyMediaSessionMetadata(track) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const cover = track.coverUrl || '';
  const artwork = cover
    ? [
        { src: cover, sizes: '96x96',   type: 'image/jpeg' },
        { src: cover, sizes: '192x192', type: 'image/jpeg' },
        { src: cover, sizes: '256x256', type: 'image/jpeg' },
        { src: cover, sizes: '384x384', type: 'image/jpeg' },
        { src: cover, sizes: '512x512', type: 'image/jpeg' },
      ]
    : [];
  // CRÍTICO: iOS usa la presencia de `album` para diferenciar música de
  // podcast. Si está vacío, asume podcast → muestra ±10s. Siempre poner algo.
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title || 'Ritmiq',
    artist: track.artist || 'Ritmiq',
    album: track.album || track.artist || 'Mi música',
    artwork,
  });
  // Position state inmediato con duración finita conocida del metadata.
  // Sin esto, iOS lee audio.duration (que suele ser Infinity al stremear) y
  // dibuja el layout de podcast con ±10s en vez del de música con prev/next.
  try {
    const dur = Number(track.durationSeconds);
    if (Number.isFinite(dur) && dur > 0 && navigator.mediaSession.setPositionState) {
      navigator.mediaSession.setPositionState({
        duration: dur,
        position: 0,
        playbackRate: 1,
      });
    }
  } catch {}
}
