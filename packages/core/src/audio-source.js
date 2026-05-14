/**
 * Estrategia adaptativa para resolver la fuente de audio de un track.
 * Orden: descarga local → servidor LAN del PC → edge function en cloud.
 *
 * @module @ritmiq/core/audio-source
 */

/**
 * @typedef {import('./types.js').Track} Track
 * @typedef {import('./types.js').AudioSourceResult} AudioSourceResult
 */

/**
 * @typedef {Object} ResolveAudioDeps
 * @property {(trackId: string) => Promise<string|null>} getLocalUrl
 *           Devuelve un URL reproducible (file:// en desktop, blob: en PWA) si está descargado.
 * @property {() => Promise<string|null>} getLanBaseUrl
 *           Devuelve la base URL del servidor LAN (ej. "http://192.168.1.50:3939") o null.
 * @property {(trackId: string) => Promise<{url: string, expiresAt?: number}>} resolveCloudStream
 *           Llama a la edge function 'resolve-stream' de Supabase.
 * @property {(trackId: string, baseUrl: string) => string} [buildLanStreamUrl]
 *           Opcional: permite al consumidor construir la URL de stream LAN
 *           (por ejemplo añadiendo token Bearer como query string). Si no
 *           se pasa, se usa una construcción simple sin auth.
 *
 * CONTEXTO HISTÓRICO: existió aquí una prop `getDirectStreamUrl` que
 * intentaba servir la URL firmada de googlevideo directamente al `<audio>`
 * para bypassear el proxy. Se removió por IP-lock de googlevideo. Ver
 * `lan-client.js` y `html-audio-backend.js` para más detalle.
 */

/**
 * Resuelve la mejor fuente de audio disponible para un track.
 *
 * @param {Track} track
 * @param {ResolveAudioDeps} deps
 * @returns {Promise<AudioSourceResult>}
 */
export async function resolveAudioSource(track, deps) {
  // 1. ¿Existe descargado localmente?
  const localUrl = await deps.getLocalUrl(track.id);
  if (localUrl) {
    return {
      url: localUrl,
      origin: localUrl.startsWith('blob:') ? 'local-blob' : 'local-file',
    };
  }

  // 2. ¿Hay servidor LAN accesible?
  const lanBase = await deps.getLanBaseUrl();
  if (lanBase) {
    const url = deps.buildLanStreamUrl
      ? deps.buildLanStreamUrl(track.id, lanBase)
      : `${lanBase}/stream/${encodeURIComponent(track.id)}`;
    return { url, origin: 'lan' };
  }

  // 3. Fallback: cloud edge function
  const { url, expiresAt } = await deps.resolveCloudStream(track.id);
  return { url, origin: 'cloud-stream', expiresAt };
}
