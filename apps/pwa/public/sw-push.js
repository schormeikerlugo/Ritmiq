/**
 * sw-push.js — handlers de Web Push y notification click.
 *
 * Importado por el Service Worker auto-generado de VitePWA via
 * workbox.importScripts. Se ejecuta en el contexto del SW (no en main thread).
 *
 * Los payloads de push son enviados por la Edge Function
 * `send-push-notification` con shape: { title, body, data: { type, ... } }.
 *
 * notificationclick:
 *   - Abre la PWA si ya esta abierta en una pestana.
 *   - Si no esta abierta, hace clients.openWindow('/').
 *   - El campo data.type permite al cliente saber a que ruta navegar
 *     (ej: type='share' → ?openShare=<itemId>).
 */

self.addEventListener('push', (event) => {
  let payload = { title: 'Ritmiq', body: '', data: {} };
  try {
    payload = event.data?.json() ?? payload;
  } catch {
    payload.body = event.data?.text() ?? '';
  }

  const options = {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data ?? {},
    tag: payload.data?.type ?? 'ritmiq',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};

  // URL destino segun el tipo de notificacion
  let url = '/';
  if (data.type === 'share') {
    url = '/?openTab=inbox';
  } else if (data.type === 'friend_request' || data.type === 'friend_accepted') {
    url = '/?openTab=requests';
  }

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Si hay una ventana abierta, enfocarla y mandar el evento
      for (const client of clientsList) {
        if ('focus' in client) {
          client.postMessage({ type: 'push-click', data });
          return client.focus();
        }
      }
      // Si no hay ninguna, abrir una nueva
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })(),
  );
});
