/**
 * usePush — registra el dispositivo para Web Push notifications.
 *
 * Solo opera en PWA con Service Worker. Skip en desktop/Electron (no
 * tiene SW de PWA) y en navegadores sin soporte de push.
 *
 * Flujo:
 *   1. Verifica permisos. Si 'default', pide al usuario en un momento
 *      apropiado (NO al mount inicial — esto se ofrece via UI con CTA).
 *   2. Si 'granted', se suscribe via pushManager.subscribe() con la
 *      VAPID_PUBLIC_KEY de env.
 *   3. Persiste la suscripcion en la tabla push_subscriptions de Supabase.
 *      Hace upsert por endpoint (los endpoints son unicos por device).
 *
 * @module @ritmiq/ui/lib/use-push
 */

import { useEffect, useCallback } from 'react';
import { supabase } from './supabase.js';
import { detectPlatform } from './share.js';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';

/**
 * Hook: registra el dispositivo cuando hay sesion + permiso 'granted'.
 *
 * @param {string|null} userId
 */
export function usePushRegistration(userId) {
  useEffect(() => {
    if (!userId) return;
    if (!isPushSupported()) return;
    if (Notification.permission !== 'granted') return;

    // Solo registrar en background — fire-and-forget.
    registerPushSubscription(userId).catch((err) => {
      console.warn('[push] registration failed', err);
    });
  }, [userId]);
}

/**
 * Helper exportado para pedir permiso desde una accion del usuario
 * (boton "Activar notificaciones" en Ajustes, por ejemplo).
 *
 * Devuelve true si se obtuvo el permiso Y la suscripcion fue persistida.
 *
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function requestPushPermissionAndRegister(userId) {
  if (!isPushSupported()) return false;
  if (!userId) return false;

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') return false;

  return registerPushSubscription(userId);
}

/**
 * Cancela la suscripcion local y borra la fila de push_subscriptions.
 */
export async function unregisterPush() {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

// ── internals ────────────────────────────────────────────────────────

function isPushSupported() {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window)) return false;
  if (!('Notification' in window)) return false;
  if (!VAPID_PUBLIC_KEY) return false;
  return true;
}

async function registerPushSubscription(userId) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  // Extraer claves de la suscripcion
  const p256dh = sub.getKey('p256dh');
  const auth   = sub.getKey('auth');
  if (!p256dh || !auth) return false;

  const payload = {
    user_id:    userId,
    endpoint:   sub.endpoint,
    p256dh:     bufferToBase64Url(p256dh),
    auth_key:   bufferToBase64Url(auth),
    user_agent: navigator.userAgent.slice(0, 200),
    platform:   detectPlatform(),
  };

  // Upsert por endpoint (unique constraint en la tabla)
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(payload, { onConflict: 'endpoint' });

  if (error) {
    console.warn('[push] upsert subscription failed', error);
    return false;
  }
  return true;
}

/**
 * Convierte una clave VAPID en formato base64url a Uint8Array (formato
 * requerido por pushManager.subscribe applicationServerKey).
 */
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const std = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(std);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * ArrayBuffer → base64url (sin padding, '+'→'-', '/'→'_').
 */
function bufferToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
