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
import { api, isDesktop } from './api.js';
import { isEphemeralTrack } from './track-helpers.js';
import {
  getLanBaseUrlSync, pingLan, getTunnelUrlSync, withTokenInUrl,
} from './lan-client.js';
import { getLocalBlobUrl } from './local-downloads.js';

/* ── Resolver de URL compartido entre track actual y precarga ─────────── */
function buildResolveDeps(track) {
  const ephemeral = isEphemeralTrack(track);
  return {
    getLocalUrl: async () => {
      if (!isDesktop && !ephemeral) {
        const blobUrl = await getLocalBlobUrl(track.id);
        if (blobUrl) return blobUrl;
      }
      return null;
    },
    getLanBaseUrl: async () => {
      if (isDesktop && ephemeral) return null;
      if (isDesktop) {
        const info = await api.appInfo();
        return info?.lanPort ? `http://127.0.0.1:${info.lanPort}` : null;
      }
      const lan = getLanBaseUrlSync();
      if (lan && (await pingLan(lan))) return lan;
      const tunnel = getTunnelUrlSync();
      if (tunnel && (await pingLan(tunnel, 3000))) return tunnel;
      return null;
    },
    buildLanStreamUrl: (trackId, base) =>
      withTokenInUrl(`${base}/stream/${encodeURIComponent(trackId)}`),
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

export function usePlayerEngine() {
  const backendRef = useRef(null);
  if (!backendRef.current) {
    backendRef.current = createHtmlAudioBackend();
  }
  const backend = backendRef.current;

  /** URL del siguiente track precargada, lista para swap síncrono en `ended`. */
  const nextUrlRef = useRef(null);
  /** Track al que corresponde nextUrlRef.current (para validar antes del swap). */
  const nextTrackRef = useRef(null);
  /** Id del track actualmente cargado en el <audio>. Evita doble load tras swap. */
  const loadedTrackIdRef = useRef(null);

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

    ms.setActionHandler('play',  () => store().patch({ isPlaying: true }));
    ms.setActionHandler('pause', () => store().patch({ isPlaying: false }));
    ms.setActionHandler('previoustrack', () => store().prev());
    ms.setActionHandler('nexttrack',     () => store().next());
    try { ms.setActionHandler('stop', () => { backend.pause(); store().patch({ isPlaying: false }); }); } catch {}

    // CRÍTICO para iOS: NO registrar NINGÚN handler de seek (ni seekto, ni
    // seekbackward, ni seekforward). iOS decide el layout en función de qué
    // handlers están registrados: si hay seek, muestra ±10s; si solo hay
    // prev/next, muestra los botones de pista. Limpiamos cualquier registro
    // previo por si quedó de la sesión anterior.
    try { ms.setActionHandler('seekbackward', null); } catch {}
    try { ms.setActionHandler('seekforward',  null); } catch {}
    try { ms.setActionHandler('seekto',       null); } catch {}

    return () => {
      for (const a of ['play','pause','previoustrack','nexttrack','stop']) {
        try { ms.setActionHandler(a, null); } catch {}
      }
    };
  }, [backend]);

  /* ── Posición → store + MediaSession.setPositionState ───────────────── */
  useEffect(() => {
    let lastPosUpdate = 0;
    return backend.onPosition((positionSeconds) => {
      setState({ positionSeconds });
      const now = performance.now();
      if (now - lastPosUpdate < 900) return;
      lastPosUpdate = now;
      try {
        if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
          // CLAVE: usar la duración del METADATA del track. audio.duration
          // puede ser Infinity con streaming Range → iOS interpreta como
          // live y deshabilita prev/next.
          const meta = usePlayerStore.getState().currentTrack;
          const metaDur = Number(meta?.durationSeconds) || 0;
          const audioDur = backend.duration();
          const dur = (Number.isFinite(audioDur) && audioDur > 0) ? audioDur : metaDur;
          if (Number.isFinite(dur) && dur > 0) {
            navigator.mediaSession.setPositionState({
              duration: dur,
              position: Math.min(positionSeconds, dur),
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
  useEffect(() => {
    return backend.onPosition((pos) => {
      const store = usePlayerStore.getState();
      const cur = store.currentTrack;
      if (!cur || !store.isPlaying) return;

      const audioDur = backend.duration();
      const metaDur = Number(cur.durationSeconds) || 0;
      const dur = (Number.isFinite(audioDur) && audioDur > 0) ? audioDur : metaDur;
      if (!dur || dur < 2) return;

      const remaining = dur - pos;
      // Margen 0.4s — suficiente para que iOS lo trate como continuación.
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

      const nextIdx = store.shuffle ? pickShuffleIdx(store) : store.index + 1;
      if (nextIdx < 0 || nextIdx >= store.queue.length) {
        // Fin de cola: dejar que termine naturalmente.
        return;
      }
      const nextTrack = store.queue[nextIdx];
      const preUrl = (nextTrackRef.current?.id === nextTrack.id) ? nextUrlRef.current : null;

      if (!preUrl) {
        // Precarga no lista: NO hacemos swap (no podemos resolver async sin
        // perder el contexto). Dejamos que `ended` dispare el camino lento;
        // en foreground funcionará, en lockscreen no — limitación conocida.
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

  // Reset del flag anti-dup cuando cambia el track.
  useEffect(() => { swapDoneRef.current = null; }, [currentTrack]);

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

  /* ── Track actual: cargar y reproducir ──────────────────────────────── */
  useEffect(() => {
    if (!currentTrack) return;
    // Si el track ya fue cargado por el pre-end swap, no recargamos: solo
    // sincronizamos metadata y duración. Esto evita un gap audible al
    // cambiar de canción dentro de la cola.
    if (loadedTrackIdRef.current === currentTrack.id) {
      applyMediaSessionMetadata(currentTrack);
      setState({ durationSeconds: backend.duration() });
      return;
    }

    let cancelled = false;
    applyMediaSessionMetadata(currentTrack);

    (async () => {
      try {
        setState({ error: null });
        const { url } = await resolveAudioSource(currentTrack, buildResolveDeps(currentTrack));
        if (cancelled) return;
        await backend.load(url);
        if (cancelled) return;
        loadedTrackIdRef.current = currentTrack.id;
        await backend.play();
        setState({ isPlaying: true, durationSeconds: backend.duration() });
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      } catch (err) {
        console.error('[player] load failed', err);
        setState({ isPlaying: false, error: String(err?.message ?? err) });
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      }
    })();

    return () => { cancelled = true; };
  }, [currentTrack, backend, setState]);

  /* ── PRECARGA del siguiente track como BLOB URL ─────────────────────── */
  // Resolver la URL y descargar el audio completo a memoria → blob URL.
  // Es necesario que sea blob para que iOS muestre prev/next en lockscreen
  // (los streams HTTP con duration=Infinity disparan layout de podcast).
  // El swap luego es síncrono e instantáneo.
  useEffect(() => {
    nextUrlRef.current = null;
    nextTrackRef.current = null;
    if (!currentTrack) return;
    const store = usePlayerStore.getState();
    if (store.shuffle) return;
    const nextIdx = index + 1;
    const nextTrack = queue[nextIdx];
    if (!nextTrack) return;

    let cancelled = false;
    (async () => {
      try {
        const { url } = await resolveAudioSource(nextTrack, buildResolveDeps(nextTrack));
        if (cancelled) return;
        // Convertir a blob URL EN BACKGROUND mientras suena la actual.
        const blobUrl = await backend.prepare(url);
        if (cancelled) return;
        nextUrlRef.current = blobUrl;
        nextTrackRef.current = nextTrack;
      } catch (e) {
        nextUrlRef.current = null;
        nextTrackRef.current = null;
      }
    })();
    return () => { cancelled = true; };
  }, [currentTrack, queue, index, backend]);

  /* ── play/pause sync + playbackState ────────────────────────────────── */
  useEffect(() => {
    if (isPlaying) {
      backend.play().catch(() => setState({ isPlaying: false }));
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    } else {
      backend.pause();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    }
  }, [isPlaying, backend, setState]);

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
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title || 'Ritmiq',
    artist: track.artist ?? '',
    album: track.album ?? '',
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
