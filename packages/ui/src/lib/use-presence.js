/**
 * usePresence — publica el track actual del usuario en la tabla `presence`
 * cada 30 segundos mientras reproduce, y lo elimina al pausar o al desmontar.
 *
 * Solo actua si:
 *   1. El usuario esta autenticado.
 *   2. El perfil tiene show_activity = true.
 *   3. Hay un track reproduciendose (currentTrack != null && isPlaying).
 *
 * La tabla `presence` tiene TTL de 2 minutos (expires_at). Si la PWA entra
 * en background y deja de llamar el upsert, la fila expira sola y los amigos
 * dejan de ver la presencia — sin necesidad de cleanup activo desde el cliente.
 *
 * @param {string|null} userId
 * @param {boolean} showActivity - del perfil (settings)
 */

import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../stores/player.js';
import { supabase } from './supabase.js';

const INTERVAL_MS  = 30_000;  // publicar cada 30s
const EXPIRES_SECS = 120;     // TTL: 2 minutos

export function usePresence(userId, showActivity) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying    = usePlayerStore((s) => s.isPlaying);

  // Ref del track actual para usar en el interval sin recrearlo
  const trackRef       = useRef(currentTrack);
  const isPlayingRef   = useRef(isPlaying);
  const positionRef    = useRef(0);

  // Sincronizar refs con state
  trackRef.current     = currentTrack;
  isPlayingRef.current = isPlaying;

  // Actualizar posicion en ref via suscripcion ligera (no re-render)
  useEffect(() => {
    return usePlayerStore.subscribe(
      (s) => s.positionSeconds,
      (pos) => { positionRef.current = pos; },
    );
  }, []);

  useEffect(() => {
    if (!userId || !showActivity) {
      // Si se desactiva show_activity mientras reproducia, limpiar presencia
      if (userId) clearPresence(userId);
      return;
    }

    async function publish() {
      const track     = trackRef.current;
      const playing   = isPlayingRef.current;
      const position  = positionRef.current;

      if (!track || !playing) {
        await clearPresence(userId);
        return;
      }

      const expiresAt = new Date(Date.now() + EXPIRES_SECS * 1000).toISOString();

      await supabase.from('presence').upsert({
        user_id:          userId,
        yt_id:            track.ytId ?? track.yt_id ?? null,
        title:            track.title ?? null,
        artist:           track.artist ?? null,
        cover_url:        track.coverUrl ?? track.cover_url ?? null,
        duration_seconds: track.durationSeconds ?? track.duration_seconds ?? null,
        position_seconds: Math.floor(position),
        started_at:       new Date().toISOString(),
        expires_at:       expiresAt,
      }, { onConflict: 'user_id' });
    }

    // Publicar inmediatamente al montar/cambiar track
    publish();

    // Y cada 30s mientras este montado
    const timer = setInterval(publish, INTERVAL_MS);

    return () => {
      clearInterval(timer);
      // Al desmontar (logout, cierre de app), limpiar la presencia
      clearPresence(userId);
    };
  // Dependencias: userId y showActivity. El intervalo se recrea si cambian.
  // currentTrack e isPlaying se leen via refs para no recrear el intervalo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, showActivity]);

  // Reaccion rapida: publicar inmediatamente si:
  //   - El usuario pausa/reanuda (cambio en isPlaying).
  //   - Cambia el track actual (cambio en currentTrack.ytId/id).
  // Si no esperaramos a esto, los amigos verian el track anterior hasta
  // el siguiente tick del intervalo de 30s.
  const trackKey = currentTrack?.ytId ?? currentTrack?.yt_id ?? currentTrack?.id ?? null;
  useEffect(() => {
    if (!userId || !showActivity) return;
    const track = trackRef.current;
    if (!track) return;

    if (!isPlaying) {
      clearPresence(userId);
    } else {
      publishNow(userId, track, positionRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, userId, showActivity, trackKey]);
}

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Silencia errores de red al limpiar presencia: cuando el cleanup del
 * useEffect dispara durante un unmount agresivo (navegacion, cierre de
 * pestana, app a background) el fetch se aborta a mitad y produce
 * ERR_CONNECTION_CLOSED. No es un bug funcional \u2014 la fila presence
 * tiene TTL de 2min y expira sola \u2014 pero spammea la consola.
 */
async function clearPresence(userId) {
  if (!userId) return;
  try {
    await supabase.from('presence').delete().eq('user_id', userId);
  } catch {
    // Esperado en unmount/cierre. La fila expira sola via TTL.
  }
}

async function publishNow(userId, track, position) {
  if (!userId || !track) return;
  const expiresAt = new Date(Date.now() + EXPIRES_SECS * 1000).toISOString();
  try {
    await supabase.from('presence').upsert({
      user_id:          userId,
      yt_id:            track.ytId ?? track.yt_id ?? null,
      title:            track.title ?? null,
      artist:           track.artist ?? null,
      cover_url:        track.coverUrl ?? track.cover_url ?? null,
      duration_seconds: track.durationSeconds ?? track.duration_seconds ?? null,
      position_seconds: Math.floor(position),
      started_at:       new Date().toISOString(),
      expires_at:       expiresAt,
    }, { onConflict: 'user_id' });
  } catch {
    // Mismo razonamiento: si la red se corto durante el publish, se
    // intentara de nuevo en el siguiente tick del interval.
  }
}
