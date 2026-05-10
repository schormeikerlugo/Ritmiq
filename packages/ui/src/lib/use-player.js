/**
 * Hook que vincula la store de Zustand con el backend de audio (Howler)
 * + MediaSession API para controles en lockscreen / AirPods.
 */

import { useEffect, useRef } from 'react';
import { resolveAudioSource } from '@ritmiq/core';
import { createHowlerBackend } from './howler-backend.js';
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
    backendRef.current = createHowlerBackend();
  }
  const backend = backendRef.current;

  const setState = usePlayerStore((s) => s.patch);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);

  // Suscripción a posición
  useEffect(() => {
    return backend.onPosition((positionSeconds) => {
      setState({ positionSeconds });
    });
  }, [backend, setState]);

  // Auto-avance al terminar una canción usando la cola explícita
  useEffect(() => {
    return backend.onEnded(() => {
      const store = usePlayerStore.getState();
      // repeat 'one' → reseek a 0 y seguir
      if (store.repeat === 'one' && store.currentTrack) {
        backend.seek(0);
        backend.play();
        return;
      }
      store.next();
    });
  }, [backend]);

  // Aplicar volumen en cambios
  useEffect(() => {
    backend.setVolume(volume);
  }, [backend, volume]);

  // Cuando cambia el track current → cargar y reproducir
  useEffect(() => {
    if (!currentTrack) return;
    let cancelled = false;

    (async () => {
      try {
        setState({ error: null });
        const ephemeral = isEphemeralTrack(currentTrack);

        const { url } = await resolveAudioSource(currentTrack, {
          getLocalUrl: async () => {
            // Desktop: file:// está bloqueado por CSP — dejamos que el LAN
            // server interno sirva el archivo (con Range requests).
            // PWA: leemos el blob de IndexedDB y lo servimos como blob: URL.
            if (!isDesktop && !ephemeral) {
              const blobUrl = await getLocalBlobUrl(currentTrack.id);
              if (blobUrl) return blobUrl;
            }
            return null;
          },
          getLanBaseUrl: async () => {
            // Desktop: para efímeros usamos IPC directo (más rápido que LAN).
            if (isDesktop && ephemeral) return null;
            if (isDesktop) {
              const info = await api.appInfo();
              return info?.lanPort ? `http://127.0.0.1:${info.lanPort}` : null;
            }
            // PWA: probar primero la LAN local; si no, el tunnel.
            const lan = getLanBaseUrlSync();
            if (lan && (await pingLan(lan))) return lan;
            const tunnel = getTunnelUrlSync();
            if (tunnel && (await pingLan(tunnel, 3000))) return tunnel;
            return null;
          },
          buildLanStreamUrl: (trackId, base) => {
            // Añade ?token=<accessToken> si está configurado, para que
            // <audio> autentique sin necesidad de headers.
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

              // Pre-validar que la Edge Function pueda resolver la URL.
              // Esto evita que Howler reciba un 502 con JSON y muestre
              // un críptico "load: 4". Si falla, lanzamos error claro.
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

              // OK, la Edge Function puede resolver. Construimos URL de proxy
              // con apikey en query string para que el <audio> pueda fetcharlo.
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
        await backend.play();
        setState({ isPlaying: true, durationSeconds: backend.duration() });
        applyMediaSession(currentTrack, backend, setState);
      } catch (err) {
        console.error('[player] load failed', err);
        setState({
          isPlaying: false,
          error: String(err?.message ?? err),
        });
      }
    })();

    return () => { cancelled = true; };
  }, [currentTrack, backend, setState]);

  // Sincronizar play/pause
  useEffect(() => {
    if (isPlaying) backend.play();
    else backend.pause();
  }, [isPlaying, backend]);

  return backend;
}

/**
 * @param {import('@ritmiq/core/types').Track} track
 */
function applyMediaSession(track, backend, setState) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist ?? '',
    album: track.album ?? '',
    artwork: track.coverUrl
      ? [{ src: track.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
      : [],
  });

  navigator.mediaSession.setActionHandler('play', () => {
    backend.play();
    setState({ isPlaying: true });
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    backend.pause();
    setState({ isPlaying: false });
  });
  navigator.mediaSession.setActionHandler('seekto', (d) => {
    if (typeof d.seekTime === 'number') backend.seek(d.seekTime);
  });
}
