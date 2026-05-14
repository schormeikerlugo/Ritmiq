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
 * @property {() => Promise<string|null>} [getDirectStreamUrl]
 *           Opcional: intenta resolver la URL DIRECTA de googlevideo. Si
 *           devuelve una URL, se prefiere sobre buildLanStreamUrl y se
 *           incluye `fallbackUrl` (la del proxy) en el resultado para que
 *           el reproductor pueda caer al proxy si googlevideo rechaza con 403.
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
    const proxyUrl = deps.buildLanStreamUrl
      ? deps.buildLanStreamUrl(track.id, lanBase)
      : `${lanBase}/stream/${encodeURIComponent(track.id)}`;
    // Intentar URL directa de googlevideo (bypass Tunnel/proxy). Si
    // funciona, las Range requests del <audio> van directo y son mucho
    // más rápidas. Si no (sin ytId, error de red), seguimos con el proxy.
    if (deps.getDirectStreamUrl) {
      try {
        const direct = await deps.getDirectStreamUrl();
        if (direct) {
          return { url: direct, fallbackUrl: proxyUrl, origin: 'direct' };
        }
      } catch { /* ignorar, caemos al proxy */ }
    }
    return { url: proxyUrl, origin: 'lan' };
  }

  // 3. Fallback: cloud edge function
  const { url, expiresAt } = await deps.resolveCloudStream(track.id);
  return { url, origin: 'cloud-stream', expiresAt };
}
