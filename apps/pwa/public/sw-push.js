/**
 * sw-push.js — handlers de Web Push y notification click.
 *
 * Importado por el Service Worker auto-generado de VitePWA via
 * workbox.importScripts. Se ejecuta en el contexto del SW (no en main thread).
 *
 * Los payloads de push son enviados por la Edge Function
 * `send-push-notification` con shape:
 *   { title, body, data: { type, tag, badgeCount, ...payload } }
 *
 * Comportamiento por plataforma:
 *   - iOS PWA 16.4+: muestra notif en lock screen + Apple Watch +
 *     centro de notificaciones. NO soporta `actions`, `vibrate`,
 *     `image`, `silent`, `requireInteraction` \u2014 los ignora.
 *   - Android Chrome: muestra notif con botones de accion (actions),
 *     vibracion, imagen rich. Soporte completo.
 *
 * IMPORTANTE iOS: showNotification debe llamarse DENTRO de
 * event.waitUntil. Si no, iOS revoca la suscripcion tras varios
 * "silent" push events (ver dev.to article sobre subs terminadas
 * tras 3 notificaciones).
 *
 * notificationclick:
 *   - Si el usuario pulsa la accion 'dismiss' \u2192 solo cerrar.
 *   - Si la app esta abierta \u2192 enfocar + postMessage push-click.
 *   - Si no esta abierta \u2192 abrir URL contextual segun data.type.
 */

self.addEventListener('push', (event) => {
  let payload = { title: 'Ritmiq', body: '', data: {} };
  try {
    payload = event.data?.json() ?? payload;
  } catch {
    payload.body = event.data?.text() ?? '';
  }

  // Badge nativo (contador rojo en icono iOS/Android). El backend
  // envia el conteo total de items sin leer para este usuario.
  // setAppBadge en el contexto del SW funciona aunque la app no
  // este abierta \u2014 unica forma de mantener el badge sincronizado.
  if (typeof payload.data?.badgeCount === 'number' && self.navigator?.setAppBadge) {
    self.navigator.setAppBadge(payload.data.badgeCount).catch(() => {});
  }

  // tag unico por notificacion individual, NO por categoria.
  // Si usamos tag=data.type (ej. 'share'), dos shares seguidos se
  // sobrescriben en el centro de notificaciones — el usuario solo ve
  // el ultimo. Backend envia tag = `${type}:${itemId}`.
  const tag = payload.data?.tag ?? payload.data?.type ?? 'ritmiq';

  // actions: solo Android Chrome los muestra. iOS Safari y desktop
  // Safari los IGNORAN silenciosamente — no es un error. Progressive
  // enhancement: en Android el usuario puede pulsar "Ver" o "Ignorar"
  // directamente desde la notif sin abrir la app.
  //
  // Las actions son contextuales por tipo de notif:
  //   share \u2192 [Ver, Ignorar]
  //   friend_request \u2192 [Aceptar, Rechazar]  (futuro: requiere endpoint
  //     que acepte sin abrir la app; por ahora reusamos Ver)
  //   friend_accepted \u2192 [Ver perfil]
  const actions = buildActions(payload.data?.type);

  const options = {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data ?? {},
    tag,
    renotify: true,
    actions,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const action = event.action; // '' si tap directo, 'open'/'dismiss'/etc si action button

  // Accion explicita "Ignorar/Rechazar" \u2014 solo cerrar, no abrir.
  if (action === 'dismiss') return;

  // URL destino segun el tipo de notificacion + accion.
  let url = '/';
  if (data.type === 'share') {
    url = '/?openTab=inbox';
  } else if (data.type === 'friend_request' || data.type === 'friend_accepted') {
    url = '/?openTab=requests';
  }

  // Limpiar badge al interactuar — el usuario va a leer.
  if (self.navigator?.clearAppBadge) {
    self.navigator.clearAppBadge().catch(() => {});
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
          client.postMessage({ type: 'push-click', data, action });
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

/**
 * Genera el array de actions segun el tipo de notif. Devuelve [] si
 * no aplica (iOS las ignora; en Android Chrome se renderizan como
 * botones bajo el texto de la notif).
 */
function buildActions(type) {
  if (type === 'share') {
    return [
      { action: 'open',    title: 'Escuchar' },
      { action: 'dismiss', title: 'Ignorar' },
    ];
  }
  if (type === 'friend_request') {
    return [
      { action: 'open',    title: 'Ver' },
      { action: 'dismiss', title: 'Mas tarde' },
    ];
  }
  if (type === 'friend_accepted') {
    return [{ action: 'open', title: 'Ver perfil' }];
  }
  return [];
}
