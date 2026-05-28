/**
 * withRetry \u2014 wrapper para fetchers con retry exponencial + jitter.
 *
 * Por que existe:
 *   Muchas edge functions (recommendations, artist-detail, yt-playlist-resolve,
 *   album-resolve) dependen de APIs externas (Last.fm, YouTube Innertube) que
 *   pueden devolver 5xx transitorios o rate-limit. Hoy cada store maneja el
 *   error de forma distinta: algunos silencian, otros muestran ErrorState
 *   inmediato. No hay retry coordinado.
 *
 *   Este helper centraliza la politica:
 *     - Reintenta solo errores transitorios (network failure, 5xx, 429, 408).
 *     - Backoff exponencial: 500ms, 1s, 2s, 4s (configurable).
 *     - Jitter aleatorio +/- 20% para no estampedar el server.
 *     - Cap de intentos (default 3). Despues lanza el error original.
 *     - Cancelable via AbortSignal.
 *
 *   Errores NO retriable (4xx excepto 408/429, ParseError, sintaxis):
 *   lanzan inmediatamente sin gastar reintentos.
 *
 * API:
 *   const data = await withRetry(() => fetch(url), { maxAttempts: 3 });
 *
 *   Con clasificacion custom de errores retriables:
 *   await withRetry(fn, { isRetriable: (err) => err.status >= 500 });
 *
 * @module @ritmiq/ui/lib/with-retry
 */

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8000;
const JITTER_FACTOR = 0.2;

/**
 * Politica default: que considera retriable.
 * - Errores de red sin status (fetch failure, timeout).
 * - Status 5xx (server error).
 * - Status 429 (rate limit) y 408 (timeout).
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function defaultIsRetriable(err) {
  if (!err) return false;
  // Errores de red puros (fetch throws TypeError "Failed to fetch").
  if (err?.name === 'TypeError') return true;
  if (err?.name === 'AbortError') return false; // cancelado, no reintentar
  // Si el error trae .status (HTTP-like), filtrar por code.
  const status = err?.status ?? err?.response?.status ?? null;
  if (typeof status === 'number') {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  // Mensajes con codigo de status embebido (ej: "artist-detail 503").
  const msg = String(err?.message ?? err ?? '');
  if (/\b(5\d{2}|408|429)\b/.test(msg)) return true;
  // Falla generica de red ("Failed to fetch", "Network request failed").
  if (/network|fetch|timeout/i.test(msg)) return true;
  return false;
}

/**
 * Calcula el delay para el intento N (0-indexed) con jitter.
 * @param {number} attemptIndex
 * @param {number} baseMs
 * @param {number} maxMs
 */
function backoffMs(attemptIndex, baseMs, maxMs) {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attemptIndex));
  const jitter = exp * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(exp + jitter));
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{
 *   maxAttempts?: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 *   isRetriable?: (err: unknown) => boolean,
 *   onRetry?: (attempt: number, err: unknown, delayMs: number) => void,
 *   signal?: AbortSignal,
 * }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    isRetriable = defaultIsRetriable,
    onRetry,
    signal,
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('aborted', 'AbortError');
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = attempt === maxAttempts - 1;
      if (isLast || !isRetriable(err)) throw err;
      const delay = backoffMs(attempt, baseDelayMs, maxDelayMs);
      if (onRetry) {
        try { onRetry(attempt + 1, err, delay); } catch {}
      }
      // Sleep cancelable.
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        if (signal) {
          const onAbort = () => {
            clearTimeout(t);
            reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
          };
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener('abort', onAbort, { once: true });
          }
        }
      });
    }
  }
  // Defensivo: nunca deberia llegar aqui (el for-loop lanza antes).
  throw lastErr;
}
