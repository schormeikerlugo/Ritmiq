/**
 * Notificaciones del sistema cuando cambia la pista en Desktop (Electron).
 *
 * - Solo activo si `isDesktop === true`.
 * - Pide permiso al primer cambio de pista.
 * - Solo notifica si la ventana NO esta enfocada (no spamea si el user
 *   esta mirando la app).
 * - Reemplaza la notificacion anterior (tag fijo).
 * - Click en la notificacion → enfoca la ventana de la app.
 *
 * @module @ritmiq/ui/lib/use-desktop-notifications
 */
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../stores/player.js';
import { isDesktop } from './api.js';

const NOTIF_TAG = 'ritmiq-now-playing';

/**
 * Pide permiso una vez. Cachea el resultado en memoria — no toca DOM.
 * @returns {Promise<NotificationPermission>}
 */
let permissionCache = null;
async function ensurePermission() {
  if (typeof Notification === 'undefined') return 'denied';
  if (permissionCache) return permissionCache;
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    permissionCache = Notification.permission;
    return permissionCache;
  }
  try {
    permissionCache = await Notification.requestPermission();
  } catch {
    permissionCache = 'denied';
  }
  return permissionCache;
}

export function useDesktopNotifications() {
  const lastTrackIdRef = useRef(null);

  useEffect(() => {
    if (!isDesktop) return;
    if (typeof Notification === 'undefined') return;

    const unsub = usePlayerStore.subscribe((state, prev) => {
      const cur = state.currentTrack;
      // Solo notifica cuando CAMBIA de track — no en play/pause del mismo.
      if (!cur) return;
      if (cur.id === lastTrackIdRef.current) return;
      lastTrackIdRef.current = cur.id;

      // No notificar si el user esta mirando la ventana.
      if (typeof document !== 'undefined' && document.hasFocus()) return;

      ensurePermission().then((perm) => {
        if (perm !== 'granted') return;
        try {
          const n = new Notification(cur.title || 'Reproduciendo', {
            body: [cur.artist, cur.album].filter(Boolean).join(' — ') || 'Ritmiq',
            icon: cur.coverUrl || undefined,
            tag: NOTIF_TAG,            // reemplaza la anterior con el mismo tag
            silent: true,              // sin sonido del SO (la musica ya suena)
            renotify: true,
          });
          n.onclick = () => {
            try { window.focus(); } catch {}
            n.close();
          };
        } catch (err) {
          // Notification puede tirar si el tab esta congelado o si Electron
          // bloquea por permisos del SO. Silencioso — no es critico.
        }
      });
    });
    return () => unsub();
  }, []);
}
