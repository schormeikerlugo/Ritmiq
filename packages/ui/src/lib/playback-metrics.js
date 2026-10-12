/**
 * Telemetría de "tiempo hasta que suena": desde que el player empieza a
 * cargar una canción hasta que `play()` confirma reproducción (o el error
 * final). Se guarda en `playback_metrics` (RLS: solo el dueño) para medir
 * con datos reales cada mejora de reproducción.
 *
 * Fire-and-forget: nunca bloquea ni rompe la reproducción.
 *
 * @module @ritmiq/ui/lib/playback-metrics
 */

import { supabase } from './supabase.js';
import { isDesktop } from './api.js';
import { detectPlatform } from './share.js';

/**
 * @param {Object} m
 * @param {string|null} m.ytId
 * @param {number} m.ms           Milisegundos hasta sonar (o hasta fallar).
 * @param {string|null} m.origin  Origen del stream (resolveAudioSource).
 * @param {'playing'|'error'} [m.outcome]
 */
export function recordPlaybackMetric({ ytId, ms, origin, outcome = 'playing' }) {
  if (!Number.isFinite(ms) || ms < 0 || ms > 600_000) return;
  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase.from('playback_metrics').insert({
        user_id: session.user.id,
        yt_id: ytId,
        ms_to_play: Math.round(ms),
        origin: origin ?? null,
        platform: isDesktop ? 'desktop' : detectPlatform(),
        outcome,
      });
    } catch { /* telemetría best-effort */ }
  })();
}
