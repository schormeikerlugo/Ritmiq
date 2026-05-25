/**
 * @module @ritmiq/ui/lib/publish-meta-edit
 *
 * Helper para que las ediciones manuales del usuario sobre title/artist
 * de un track contribuyan al diccionario global [[tracks_global]].
 *
 * COMPORTAMIENTO
 *
 *   - Si era el PRIMER humano publicando ese ytId → su edición se vuelve
 *     canónica (first-write-wins en publish-track-meta).
 *   - Si ya estaba canonizado → solo incrementa contribution_count (sin
 *     efecto sobre los campos canonicalizados, anti-spam por diseño).
 *
 * Por qué un helper SEPARADO de publishTrackMeta (en use-player.js):
 *   - publishTrackMeta tiene su propio Set de dedupe (publishedMetaInSession)
 *     basado en ytId. Si el user reproduce un track y luego lo edita, el
 *     dedupe bloquearia el segundo publish (mismo ytId).
 *   - Aqui usamos un Set distinto con clave compuesta (ytId + hash de
 *     campos) para que cada EDICION distinta cuente como un publish
 *     diferente, sin perder el dedupe de "no spamear la misma edicion".
 *   - Esto convierte al usuario en COLABORADOR explicito del diccionario
 *     publico cada vez que limpia un titulo.
 *
 * PRIVACIDAD: igual que publishTrackMeta — no se envia user_id, IP, ni
 * device_id. Solo {ytId, title, artist, album?, coverUrl?, duration?}.
 *
 * @see use-player.js:publishTrackMeta
 * @see supabase/functions/publish-track-meta/index.ts
 */

import { supabase } from './supabase.js';

/**
 * Dedupe in-memory de ediciones publicadas en esta sesión. Clave:
 * `${ytId}::${title}::${artist}` — si el user edita el mismo track varias
 * veces con los mismos valores, no spamea el Edge. Si ajusta y vuelve a
 * editar con valores distintos, cada combinación cuenta.
 *
 * @type {Set<string>}
 */
const publishedEdits = new Set();

/**
 * Stats observables — accesibles desde Diagnostics si quisieramos
 * mostrar "N contribuciones manuales tuyas esta sesion".
 */
export const metaEditPublishStats = {
  attempts: 0,
  successes: 0,
  failures: 0,
  lastSuccessAt: null,
  lastError: null,
};

/**
 * Publica una edicion manual del usuario al diccionario global.
 * Fire-and-forget: no afecta latencia del save del modal.
 *
 * @param {import('@ritmiq/core').Track} track  Track ya con valores editados.
 */
export async function publishMyMetaEdit(track) {
  if (!track?.ytId) return;
  if (!track.title || !track.artist) return;

  const key = `${track.ytId}::${track.title}::${track.artist}`;
  if (publishedEdits.has(key)) return;
  publishedEdits.add(key);

  const sup = import.meta.env.VITE_SUPABASE_URL;
  const apikey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!sup || !apikey) return;

  metaEditPublishStats.attempts++;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      publishedEdits.delete(key);
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
    metaEditPublishStats.successes++;
    metaEditPublishStats.lastSuccessAt = Date.now();
  } catch (err) {
    metaEditPublishStats.failures++;
    metaEditPublishStats.lastError = {
      message: String(err?.message ?? err).slice(0, 200),
      at: Date.now(),
    };
    publishedEdits.delete(key); // permitir reintentar
  }
}
