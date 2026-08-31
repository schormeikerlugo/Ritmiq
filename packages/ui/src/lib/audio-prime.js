/**
 * Puente para "primar" (desbloquear) el <audio> dentro del gesto del usuario,
 * sin acoplar el store del player al backend de audio.
 *
 * iOS Safari exige que audio.play() ocurra cerca del gesto. Nuestra
 * reproducción real hace varios `await` (prewarm, resolver URL, load) ANTES
 * de play(), así que iOS descarta la activación → la canción no suena (el
 * botón parpadea play/pausa). Llamando `primeAudioForPlayback()` SÍNCRONO en
 * el handler del tap (p.ej. dentro de playNow), el <audio> queda "activado"
 * y el play() posterior se permite aunque llegue segundos después.
 *
 * `use-player.js` registra la implementación real (que llama al backend);
 * el store la invoca sin importar el backend (evita ciclos de import).
 *
 * @module @ritmiq/ui/lib/audio-prime
 */

/** @type {(() => void) | null} */
let primeImpl = null;

/** Registra la implementación real (llamado por use-player al montar). */
export function registerAudioPrime(fn) {
  primeImpl = typeof fn === 'function' ? fn : null;
}

/**
 * Desbloquea el <audio> dentro del gesto actual. No-op si aún no se registró
 * el backend. Debe llamarse SÍNCRONO en el handler del tap (sin await antes).
 */
export function primeAudioForPlayback() {
  try { primeImpl?.(); } catch { /* best-effort */ }
}
