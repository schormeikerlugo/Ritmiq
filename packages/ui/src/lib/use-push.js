/**
 * usePush — registra el dispositivo para Web Push notifications.
 *
 * Disenado para sobrevivir las particularidades de iOS PWA:
 *   - Drift detection: en cada arranque compara el endpoint local
 *     (pushManager.getSubscription) con lo que tenemos en DB. Si
 *     difieren, re-sincroniza. Si la suscripcion local desaparecio
 *     (Safari las invalida tras semanas de inactividad), re-suscribe
 *     silenciosamente porque el permiso sigue 'granted'.
 *   - Permission sync: cuando el usuario vuelve a foco, detecta si
 *     revoco permisos desde Ajustes iOS y limpia la fila de DB.
 *   - removePushDevice: borra solo la fila de DB SIN llamar a
 *     sub.unsubscribe(). En iOS, una vez unsubscribed Safari bloquea
 *     re-suscripcion sin gesto explicito del usuario — por eso
 *     reservamos el unsubscribe local para una accion separada
 *     "Olvidar este dispositivo".
 *
 * @module @ritmiq/ui/lib/use-push
 */

import { useEffect } from 'react';
import { supabase } from './supabase.js';
import { detectPlatform } from './share.js';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';

/**
 * Hook: en cada arranque, si hay sesion + permiso 'granted',
 * verifica y sincroniza la suscripcion push. Tambien re-comprueba al
 * volver de background (visibilitychange visible) para detectar
 * revocaciones de permisos desde Ajustes iOS.
 *
 * @param {string|null} userId
 */
export function usePushRegistration(userId) {
  useEffect(() => {
    if (!userId) return;
    if (!isPushSupported()) return;

    // Sync inicial.
    syncSubscription(userId).catch((err) => {
      console.warn('[push] initial sync failed', err);
    });

    // Re-sync al volver a foco: detecta cambios externos del permiso
    // (usuario revoco desde Ajustes iOS/Android sin abrir la app).
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      syncSubscription(userId).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [userId]);
}

/**
 * Helper exportado para pedir permiso desde una accion del usuario
 * (boton "Activar notificaciones" en Ajustes).
 *
 * IMPORTANTE iOS: debe llamarse en respuesta directa a un click.
 * Llamarlo desde setTimeout o efectos es silenciosamente bloqueado.
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
 * Quita la fila de push_subscriptions de este endpoint en la DB
 * SIN llamar a sub.unsubscribe(). Uso: logout o toggle "Desactivar".
 *
 * Por que no unsubscribe: en iOS, tras unsubscribe() Safari bloquea
 * re-suscripcion sin gesto explicito del usuario. Si el usuario
 * desactiva-activa el toggle dos veces, la segunda vez no funciona.
 * Mantener la suscripcion local viva y solo borrar la fila del
 * backend resuelve esto — el push llega al device, el SW lo recibe,
 * pero como el backend no tiene la fila simplemente no se enviaran
 * mas. Y al re-activar, basta con re-upsert la misma suscripcion.
 *
 * @returns {Promise<void>}
 */
export async function removePushDevice() {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
}

/**
 * Borra la fila de DB Y cancela la suscripcion local. Solo usar
 * desde una accion explicita "Olvidar este dispositivo" — NO desde
 * logout normal ni desde toggle.
 *
 * @returns {Promise<void>}
 */
export async function forgetPushDevice() {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

/**
 * Alias retro-compatible. Algunos componentes legacy importan
 * unregisterPush directamente — preservamos el nombre pero ahora
 * apunta a la version segura (no llama unsubscribe).
 */
export const unregisterPush = removePushDevice;

// ── internals ────────────────────────────────────────────────────────

function isPushSupported() {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window)) return false;
  if (!('Notification' in window)) return false;
  if (!VAPID_PUBLIC_KEY) return false;
  return true;
}

/**
 * Reconcilia el estado entre cliente y backend. Casos posibles:
 *
 *   1. permission != 'granted' + hay fila en DB → permiso revocado
 *      externamente, borramos la fila.
 *   2. permission == 'granted' + no hay suscripcion local + hay fila
 *      en DB → Safari invalido la sub, re-suscribimos silenciosamente.
 *   3. permission == 'granted' + hay suscripcion local + endpoint
 *      cambio respecto a DB → upsert el nuevo endpoint.
 *   4. permission == 'granted' + estado consistente → no-op.
 */
async function syncSubscription(userId) {
  // Caso 1: permiso revocado externamente.
  if (Notification.permission !== 'granted') {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    }
    return;
  }

  // Casos 2-4: hay permiso, asegurar coherencia.
  return registerPushSubscription(userId);
}

async function registerPushSubscription(userId) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();

  if (!sub) {
    // Caso 2 (re-suscripcion silenciosa tras invalidacion).
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

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

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(payload, { onConflict: 'endpoint' });

  if (error) {
    console.warn('[push] upsert subscription failed', error);
    return false;
  }
  return true;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const std = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(std);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufferToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
