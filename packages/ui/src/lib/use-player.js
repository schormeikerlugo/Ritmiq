/**
 * Hook que vincula la store de Zustand con el backend de audio (HTMLAudioElement
 * singleton) + MediaSession API completa para controles en lockscreen / AirPods
 * y reproducción continua con pantalla bloqueada.
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

export function usePlayerEngine() {
  const backendRef = useRef(null);

  if (!backendRef.current) {
    backendRef.current = createHtmlAudioBackend();
  }
  const backend = backendRef.current;

  const setState = usePlayerStore((s) => s.patch);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);

  // Unlock del `<audio>` en el PRIMER gesto del usuario. Sin esto, iOS no
  // autoriza play() programáticos en background. La técnica: crear el elemento
  // y disparar play() muteado dentro del gesto; iOS lo marca como "autorizado"
  // para toda la sesión y los siguientes play() en background ya funcionan.
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
            p.then(() => { el.pause(); el.muted = wasMuted; }).catch(() => { el.muted = wasMuted; });
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

  // Registrar handlers MediaSession UNA SOLA VEZ.
  // Estos no dependen del track, solo del store, así que se quedan vivos toda
  // la sesión y iOS los considera "completos" (criterio para no suspender la
  // sesión al bloquear pantalla).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const store = () => usePlayerStore.getState();

    ms.setActionHandler('play', () => {
      store().patch({ isPlaying: true });
    });
    ms.setActionHandler('pause', () => {
      store().patch({ isPlaying: false });
    });
    ms.setActionHandler('previoustrack', () => { store().prev(); });
    ms.setActionHandler('nexttrack',     () => { store().next(); });
    ms.setActionHandler('seekbackward', (d) => {
      const offset = (d && typeof d.seekOffset === 'number') ? d.seekOffset : 10;
      const cur = backend.element()?.currentTime ?? 0;
      backend.seek(Math.max(0, cur - offset));
    });
    ms.setActionHandler('seekforward', (d) => {
      const offset = (d && typeof d.seekOffset === 'number') ? d.seekOffset : 10;
      const dur = backend.element()?.duration ?? 0;
      const cur = backend.element()?.currentTime ?? 0;
      backend.seek(Math.min(dur || cur + offset, cur + offset));
    });
    ms.setActionHandler('seekto', (d) => {
      if (d && typeof d.seekTime === 'number') backend.seek(d.seekTime);
    });
    try { ms.setActionHandler('stop', () => { backend.pause(); store().patch({ isPlaying: false }); }); } catch {}

    return () => {
      // Limpiar (mejor práctica para HMR; en prod el componente vive toda la sesión).
      for (const a of ['play','pause','previoustrack','nexttrack','seekbackward','seekforward','seekto','stop']) {
        try { ms.setActionHandler(a, null); } catch {}
      }
    };
  }, [backend]);

  // Subscripción a posición → actualizar store + MediaSession positionState.
  // iOS necesita setPositionState con cierta frecuencia para considerar que
  // la sesión está activa y no suspenderla.
  useEffect(() => {
    let lastPosUpdate = 0;
    return backend.onPosition((positionSeconds) => {
      setState({ positionSeconds });
      const now = performance.now();
      if (now - lastPosUpdate < 900) return; // ~1Hz para no saturar
      lastPosUpdate = now;
      try {
        if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
          const dur = backend.duration();
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

  // Auto-avance al terminar una canción usando la cola explícita.
  useEffect(() => {
    return backend.onEnded(() => {
      const store = usePlayerStore.getState();
      if (store.repeat === 'one' && store.currentTrack) {
        backend.seek(0);
        backend.play().catch(() => {});
        return;
      }
      store.next();
    });
  }, [backend]);

  // Aplicar volumen en cambios.
  useEffect(() => {
    backend.setVolume(volume);
  }, [backend, volume]);

  // Cuando cambia el track current → cargar y reproducir, REUSANDO el `<audio>`.
  useEffect(() => {
    if (!currentTrack) return;
    let cancelled = false;

    // Aplicar la metadata de MediaSession ANTES del play. Crucial en iOS:
    // si la sesión no tiene metadata al momento del play, no se asocia al
    // `<audio>` y el lockscreen no muestra nada (→ suspensión rápida).
    applyMediaSessionMetadata(currentTrack);

    (async () => {
      try {
        setState({ error: null });
        const ephemeral = isEphemeralTrack(currentTrack);

        const { url } = await resolveAudioSource(currentTrack, {
          getLocalUrl: async () => {
            if (!isDesktop && !ephemeral) {
              const blobUrl = await getLocalBlobUrl(currentTrack.id);
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
          buildLanStreamUrl: (trackId, base) => {
            return withTokenInUrl(`${base}/stream/${encodeURIComponent(trackId)}`);
          },
          resolveCloudStream: async () => {
            if (isDesktop && currentTrack.ytId) {
              const url = await api.ytStreamUrl(currentTrack.ytId);
              return { url };
            }
            if (currentTrack.ytId) {
              const base = import.meta.env.VITE_SUPABASE_URL;
              const apikey = import.meta.env.VITE_SUPABASE_ANON_KEY;
              if (!base) throw new Error('Supabase URL no configurado');
              const probeUrl =
                `${base}/functions/v1/resolve-stream?ytId=${encodeURIComponent(currentTrack.ytId)}` +
                (apikey ? `&apikey=${encodeURIComponent(apikey)}` : '');
              const probe = await fetch(probeUrl);
              if (!probe.ok) {
                let detail = '';
                try { detail = (await probe.json())?.error ?? ''; } catch {}
                throw new Error(
                  'Esta canción no se puede reproducir desde el navegador sin tu PC. ' +
                  (detail ? `(${detail}) ` : '') +
                  'Conecta vía LAN/Tailscale o pre-descárgala en casa.'
                );
              }
              const url =
                `${base}/functions/v1/resolve-stream?ytId=${encodeURIComponent(currentTrack.ytId)}&proxy=1` +
                (apikey ? `&apikey=${encodeURIComponent(apikey)}` : '');
              return { url };
            }
            throw new Error('Stream no disponible');
          },
        });

        if (cancelled) return;
        await backend.load(url);
        if (cancelled) return;
        await backend.play();
        setState({ isPlaying: true, durationSeconds: backend.duration() });
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
      } catch (err) {
        console.error('[player] load failed', err);
        setState({
          isPlaying: false,
          error: String(err?.message ?? err),
        });
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'paused';
        }
      }
    })();

    return () => { cancelled = true; };
  }, [currentTrack, backend, setState]);

  // Sincronizar play/pause + playbackState para que iOS muestre el icono correcto
  // en el lockscreen y mantenga la prioridad alta.
  useEffect(() => {
    if (isPlaying) {
      backend.play().catch(() => {
        setState({ isPlaying: false });
      });
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
 * Se llama ANTES del primer play() de cada canción.
 * @param {import('@ritmiq/core/types').Track} track
 */
function applyMediaSessionMetadata(track) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const cover = track.coverUrl || '';
  const artwork = cover
    ? [
        // Varios tamaños para que el SO escoja el adecuado para lockscreen / CarPlay.
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
