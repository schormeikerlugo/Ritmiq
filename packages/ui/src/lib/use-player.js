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
    ms.setActionHandler('seekto', (d) => {
      if (d && typeof d.seekTime === 'number') backend.seek(d.seekTime);
    });
    try { ms.setActionHandler('stop', () => { backend.pause(); store().patch({ isPlaying: false }); }); } catch {}

    // Aseguramos que seek±10 NO estén registrados (por si el navegador los
    // dejó de una sesión previa).
    try { ms.setActionHandler('seekbackward', null); } catch {}
    try { ms.setActionHandler('seekforward',  null); } catch {}

    return () => {
      for (const a of ['play','pause','previoustrack','nexttrack','seekto','stop']) {
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

  /* ── Evento `ended`: swap SÍNCRONO al siguiente, sin pasar por React ── */
  useEffect(() => {
    return backend.onEnded(() => {
      const store = usePlayerStore.getState();
      // Repeat one: reseek y seguir.
      if (store.repeat === 'one' && store.currentTrack) {
        backend.seek(0);
        backend.play().catch(() => {});
        return;
      }
      // Si hay URL precargada para el siguiente track esperado → swap inmediato
      // dentro del mismo task del evento `ended`. Esto preserva la autorización
      // de iOS para reproducir en background.
      const nextIdx = store.shuffle
        ? -1 // shuffle no es predecible → caemos al path lento
        : store.index + 1;
      if (
        nextIdx >= 0 &&
        nextIdx < store.queue.length &&
        nextUrlRef.current &&
        nextTrackRef.current?.id === store.queue[nextIdx].id
      ) {
        // 1) Swap síncrono del audio (iOS conserva la sesión).
        backend.swapAndPlay(nextUrlRef.current);
        // 2) Actualizar metadata MediaSession síncronamente.
        applyMediaSessionMetadata(store.queue[nextIdx]);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
        // 3) Sincronizar el store DESPUÉS (React).
        store.patch({
          index: nextIdx,
          currentTrack: store.queue[nextIdx],
          isPlaying: true,
          positionSeconds: 0,
        });
        // Invalida la precarga consumida.
        nextUrlRef.current = null;
        nextTrackRef.current = null;
        return;
      }
      // Fallback (precarga no disponible o shuffle): camino lento por React.
      store.next();
    });
  }, [backend]);

  /* ── Aplicar volumen ────────────────────────────────────────────────── */
  useEffect(() => { backend.setVolume(volume); }, [backend, volume]);

  /* ── Track actual: cargar y reproducir ──────────────────────────────── */
  useEffect(() => {
    if (!currentTrack) return;
    let cancelled = false;

    // Metadata ANTES del play — crítico para que iOS asocie la sesión.
    applyMediaSessionMetadata(currentTrack);

    (async () => {
      try {
        setState({ error: null });
        const { url } = await resolveAudioSource(currentTrack, buildResolveDeps(currentTrack));
        if (cancelled) return;
        await backend.load(url);
        if (cancelled) return;
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

  /* ── PRECARGA de la URL del siguiente track ─────────────────────────── */
  // Cuando cambia el track actual o la cola, resolvemos la URL del siguiente
  // en background y la dejamos lista en nextUrlRef para el swap síncrono.
  useEffect(() => {
    nextUrlRef.current = null;
    nextTrackRef.current = null;
    if (!currentTrack) return;
    const store = usePlayerStore.getState();
    if (store.shuffle) return; // shuffle no es predecible
    const nextIdx = index + 1;
    const nextTrack = queue[nextIdx];
    if (!nextTrack) return;

    let cancelled = false;
    (async () => {
      try {
        const { url } = await resolveAudioSource(nextTrack, buildResolveDeps(nextTrack));
        if (cancelled) return;
        nextUrlRef.current = url;
        nextTrackRef.current = nextTrack;
      } catch (e) {
        // Falló pre-resolución → caeremos al camino lento en `ended`.
        nextUrlRef.current = null;
        nextTrackRef.current = null;
      }
    })();
    return () => { cancelled = true; };
  }, [currentTrack, queue, index]);

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
 * Registra la metadata visible en lockscreen / Centro de control / AirPods.
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
}
