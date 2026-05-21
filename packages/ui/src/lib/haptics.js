/**
 * haptics.js — vibracion sutil en acciones clave.
 *
 * Soporte:
 *   - Android Chrome \u2014 si.
 *   - iOS Safari/PWA \u2014 NO. WebKit ignora navigator.vibrate
 *     silenciosamente. Apple solo expone haptics a apps nativas via
 *     UIImpactFeedbackGenerator. Llamarlo no rompe nada \u2014 just no-op.
 *   - Desktop \u2014 ignorado (no hace falta feature-detect).
 *
 * Patron de uso:
 *
 *   import { hapticTap, hapticSuccess, hapticError } from '@ritmiq/ui/lib/haptics';
 *
 *   onClick={() => { hapticTap(); doStuff(); }}
 *   onShareSuccess={() => hapticSuccess()}
 *   onError={() => hapticError()}
 *
 * Filosofia:
 *   - tap: confirmacion ligera (10ms) para acciones cotidianas.
 *   - success: 3 pulsos cortos para confirmar exito (share enviado).
 *   - error: 3 pulsos mas largos para senalar fallo.
 *
 * Respetar prefers-reduced-motion: si el usuario lo activo, skipear
 * tambien la vibracion (mismo principio que animaciones).
 *
 * @module @ritmiq/ui/lib/haptics
 */

/**
 * Vibracion ligera para confirmar un tap (like, anadir a cola,
 * cambiar tab). Imperceptible-pero-presente.
 */
export function hapticTap() {
  vibrate(10);
}

/**
 * Patron de exito: tres pulsos cortos crecientes. Para "share enviado",
 * "playlist creada", "amigo aceptado".
 */
export function hapticSuccess() {
  vibrate([15, 40, 15, 40, 25]);
}

/**
 * Patron de error: pulsos largos espaciados. Para "fallo al guardar",
 * "permission denied", "endpoint expirado".
 */
export function hapticError() {
  vibrate([60, 60, 60, 60, 60]);
}

// ── internals ────────────────────────────────────────────────────────

function vibrate(pattern) {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  // Respeta prefers-reduced-motion (accesibilidad). El usuario que
  // pidio reducir animaciones probablemente quiere menos haptics tambien.
  try {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq?.matches) return;
  } catch {}
  try {
    navigator.vibrate(pattern);
  } catch {
    // Algunos navegadores throwean SecurityError fuera de gesto del
    // usuario \u2014 silencioso, no es critico.
  }
}
