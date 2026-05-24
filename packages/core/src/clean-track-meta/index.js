/**
 * @module @ritmiq/core/clean-track-meta
 *
 * Utilidad canonica para normalizar metadata de tracks ANTES de
 * persistirlos o canonizarlos en tracks_global. Reemplaza el caos
 * de titulos como "Waiting For The End (Official Music Video)
 * [4K Upgrade]" por "Waiting For The End" + artist="Linkin Park".
 *
 * MODULOS:
 *   - patterns.js   → regex idempotentes con whitelist de keywords.
 *   - uploader.js   → cleanUploader, isGenericUploader.
 *   - title.js      → cleanYoutubeTitle (orquestador para input crudo YT).
 *   - normalize.js  → normalizeMeta (para fuentes ya estructuradas).
 *
 * MIRROR DENO: supabase/functions/_shared/clean-track-meta.ts mantiene
 * una copia compatible con TypeScript/Deno para uso en Edge Functions.
 * Mantener ambos sincronizados al editar.
 *
 * @see docs/Ritmiq-Docs/06-DB/cleaning-titles.md  (documentacion completa)
 */

export { cleanYoutubeTitle } from './title.js';
export { cleanUploader, isGenericUploader } from './uploader.js';
export { normalizeMeta } from './normalize.js';

// Re-export de patterns para tests / debugging.
export * as patterns from './patterns.js';
