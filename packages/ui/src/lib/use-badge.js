/**
 * useAppBadge — Badging API nativa para mostrar contador en el icono.
 *
 * En iOS PWA 16.4+ y Android Chrome (instalada), el icono de la app
 * en home screen / app drawer puede llevar un badge numerico rojo
 * como cualquier app nativa (Mail, Mensajes, etc).
 *
 * Soporte:
 *   - iOS PWA 16.4+: si.
 *   - Android Chrome instalada: si.
 *   - Desktop PWA (Chrome/Edge): si.
 *   - Safari iOS (no instalada): no \u2014 API no expuesta.
 *   - Firefox: no.
 *
 * IMPORTANTE iOS: el badge requiere que el usuario haya concedido
 * permiso de notificaciones. Sin permission='granted', setAppBadge
 * no falla pero tampoco hace nada visible.
 *
 * Estrategia:
 *   - Llamamos setAppBadge(n) cuando el contador cambia.
 *   - clearAppBadge() cuando el usuario abre la vista de Amigos
 *     (lugar donde lee shares/solicitudes).
 *   - clearAppBadge() al cerrar la app si el usuario lo dejo en
 *     foreground viendo amigos (visibilitychange -> hidden).
 *
 * @module @ritmiq/ui/lib/use-badge
 */

import { useEffect, useRef } from 'react';

/**
 * Sincroniza el badge del icono de la app con un conteo derivado del
 * estado social. Hace debounce 200ms para no spammear al SO cuando
 * llegan rafagas de eventos realtime.
 *
 * @param {number} count
 * @param {boolean} [autoClearOnViewing=false] - si true, llamar
 *   clearAppBadge() ignorando el count. Util cuando el usuario esta
 *   en la vista que muestra estos items \u2014 ya los esta viendo.
 */
export function useAppBadge(count, autoClearOnViewing = false) {
  const timeoutRef = useRef(null);
  const lastValueRef = useRef(null);

  useEffect(() => {
    if (!isBadgingSupported()) return;

    // Determinar valor objetivo. Si la vista activa los muestra,
    // mantener el badge en 0 (clear) aunque haya items.
    const target = autoClearOnViewing ? 0 : Math.max(0, count | 0);

    // Skip si no hay cambio (evita writes innecesarios al SO).
    if (target === lastValueRef.current) return;

    // Debounce 200ms para coalescer rafagas (3 shares llegan en
    // 50ms -> una sola llamada en vez de 3).
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      lastValueRef.current = target;
      try {
        if (target === 0) {
          navigator.clearAppBadge?.().catch(() => {});
        } else {
          navigator.setAppBadge?.(target).catch(() => {});
        }
      } catch {
        // SecurityError u otros \u2014 silencioso, no es critico.
      }
    }, 200);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [count, autoClearOnViewing]);
}

/**
 * Helper imperativo: limpia el badge inmediatamente.
 * Util desde handlers de click (ej. tras leer un share).
 */
export function clearAppBadge() {
  if (!isBadgingSupported()) return;
  try {
    navigator.clearAppBadge?.().catch(() => {});
  } catch {}
}

function isBadgingSupported() {
  if (typeof navigator === 'undefined') return false;
  return 'setAppBadge' in navigator;
}
