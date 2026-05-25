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
 * @property {(ytId: string) => Promise<{url:string|null, contentType?:string, expiresAt?:string}|null>} [getGlobalCachedUrl]
 *           Opcional (Fase 1 cache global): consulta `stream_url_cache` en
 *           Supabase para ver si otro desktop ya resolvio este ytId.
 *           Si responde con url=null o falla, se cae al fallback cloud.
 *           El call es totalmente opcional: si el dep no esta presente
 *           la cascada se comporta exactamente como antes.
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
    // `buildLanStreamUrl` puede ser síncrono (desktop) o Promise (PWA con
    // sign-stream). `await` sirve para ambos casos.
    const url = await (deps.buildLanStreamUrl
      ? deps.buildLanStreamUrl(track.id, lanBase)
      : `${lanBase}/stream/${encodeURIComponent(track.id)}`);
    return { url, origin: 'lan' };
  }

  // 3+4. RACE PARALELO: cache global Supabase vs. cloud Edge yt-dlp.
  //
  // ANTES: secuencial — `await getGlobalCachedUrl()` (paga ~500ms cold
  // si MISS) y luego cae a resolveCloudStream(). En cache vacio (caso
  // comun cuando la red apenas arranca), CADA reproduccion ephemeral
  // pagaba esos ~500ms de "loteria" antes de yt-dlp.
  //
  // AHORA: ambos lanzados a la vez con Promise.any. Quien resuelva
  // primero con URL valida gana:
  //   - Cache HIT (~80-150ms warm): ahorra 1-3s de yt-dlp.
  //   - Cache MISS rapido (~80ms): cloud termina despues, sin penalty.
  //   - Cache MISS lento (~500ms): cloud gana eventualmente, sin penalty.
  //   - Cache error: cloud gana.
  //   - Ambos fallan: AggregateError, lanzamos el ultimo error.
  //
  // El perdedor (cloud, si gana global) sigue corriendo en background;
  // su URL se descarta. Pero la invocacion yt-dlp triggera el hook de
  // publishResolvedUrl, que popula el cache global mas rapido — efecto
  // secundario util.
  //
  // FALLBACK SECUENCIAL: si falta una de las deps (test units, etc),
  // mantenemos el comportamiento legacy para no romper consumers.
  const canCheckGlobal = !!track.ytId && typeof deps.getGlobalCachedUrl === 'function';
  const canCloud = typeof deps.resolveCloudStream === 'function';

  if (canCheckGlobal && canCloud) {
    const globalP = (async () => {
      const cached = await deps.getGlobalCachedUrl(track.ytId);
      if (cached && cached.url) {
        return { url: cached.url, origin: 'cache-global-url' };
      }
      // throw para excluir este perdedor del Promise.any (queremos solo
      // RESOLVES con URL valida, no settle).
      throw new Error('global-cache-miss');
    })();

    const cloudP = (async () => {
      const r = await deps.resolveCloudStream(track.id);
      return { url: r.url, origin: 'cloud-stream', expiresAt: r.expiresAt };
    })();

    try {
      return await Promise.any([globalP, cloudP]);
    } catch (aggregateError) {
      // Ambos fallaron. Lanzar el error mas informativo (usualmente cloud).
      const errors = aggregateError?.errors ?? [];
      throw errors[errors.length - 1] ?? aggregateError;
    }
  }

  // Path legacy si falta una dep.
  if (canCheckGlobal) {
    try {
      const cached = await deps.getGlobalCachedUrl(track.ytId);
      if (cached && cached.url) {
        return { url: cached.url, origin: 'cache-global-url' };
      }
    } catch {
      // silent fallthrough
    }
  }
  const { url, expiresAt } = await deps.resolveCloudStream(track.id);
  return { url, origin: 'cloud-stream', expiresAt };
}
