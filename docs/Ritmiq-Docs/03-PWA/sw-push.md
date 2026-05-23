---
tipo: modulo
capa: pwa
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: apps/pwa/public/sw-push.js
tags: [pwa, service-worker, push, notificaciones, ios]
---

# `sw-push.js` — handlers del Service Worker

> Handlers de `push` y `notificationclick` para el Service Worker. Importado por el SW auto-generado de VitePWA via `importScripts`. Se ejecuta en el contexto del SW, no en main thread.

## Ubicación
`apps/pwa/public/sw-push.js:1` (142 líneas)

## Cómo se carga

`vite.config.js` configura:
```js
workbox: { importScripts: ['/sw-push.js'] }
```

El SW generado por workbox carga este archivo al iniciar. Los listeners `push` y `notificationclick` quedan registrados en el SW global.

## Payload de push esperado

Enviado por [[send-push-notification]] Edge Function:

```ts
{
  title: string,
  body: string,
  data: {
    type: 'share' | 'friend_request' | 'friend_accepted' | ...,
    tag: string,           // ej. "share:itemId" (único por notif)
    badgeCount?: number,
    ...payload específico
  }
}
```

## Handler `push`

`apps/pwa/public/sw-push.js:29-76`

### Badge nativo via SW

```js
if (typeof payload.data?.badgeCount === 'number' && self.navigator?.setAppBadge) {
  self.navigator.setAppBadge(payload.data.badgeCount).catch(() => {});
}
```

**Por qué setAppBadge desde el SW**: funciona aunque la app no esté abierta. Es la única forma de mantener el badge del icono sincronizado en iOS cuando llegan notifs en background.

### `tag` único por notificación (no por categoría)

```js
const tag = payload.data?.tag ?? payload.data?.type ?? 'ritmiq';
```

Si usáramos `tag = type` (ej. `'share'`), dos shares seguidos se sobrescribirían en el centro de notificaciones. El backend envía `tag = "${type}:${itemId}"` para que cada notif sea independiente.

### `event.waitUntil(showNotification(...))` — CRÍTICO iOS

```js
event.waitUntil(
  self.registration.showNotification(payload.title, options),
);
```

iOS revoca la suscripción tras varios "silent push events" (push que no muestran notif). El `event.waitUntil` garantiza que `showNotification` se complete dentro del lifecycle del SW antes de que iOS lo considere "silent".

### Actions contextuales por tipo

```js
share          → [Escuchar, Ignorar]
friend_request → [Ver, Más tarde]
friend_accepted → [Ver perfil]
```

**Solo Android Chrome muestra `actions`**. iOS Safari y Desktop Safari las ignoran silenciosamente. No es un bug — es progressive enhancement.

## Handler `notificationclick`

`apps/pwa/public/sw-push.js:78-118`

### Routing por `data.type`

```js
share          → /?openTab=inbox
friend_request → /?openTab=requests
friend_accepted → /?openTab=requests
default        → /
```

### Si la app ya está abierta: focus + postMessage

```js
for (const client of clientsList) {
  if ('focus' in client) {
    client.postMessage({ type: 'push-click', data, action });
    return client.focus();
  }
}
```

El main thread escucha `message` event en el SW y rutea a la vista correspondiente sin recargar.

### Si no está abierta: openWindow

```js
if (self.clients.openWindow) {
  return self.clients.openWindow(url);
}
```

Abre una nueva ventana/PWA en el URL contextual.

### Limpiar badge al interactuar

```js
if (self.navigator?.clearAppBadge) {
  self.navigator.clearAppBadge().catch(() => {});
}
```

El usuario va a leer → el badge debe ponerse a 0.

## Acción `dismiss`

```js
if (action === 'dismiss') return;
```

El botón "Ignorar" / "Más tarde" cierra la notif sin abrir la app.

## Soporte por plataforma

| Feature | iOS PWA 16.4+ | Android Chrome | Desktop Chrome/Edge |
|---|---|---|---|
| `push` event | ✓ | ✓ | ✓ |
| `showNotification` | ✓ (lock screen + Apple Watch + Centro Notifs) | ✓ | ✓ |
| `actions` (botones) | ✗ ignorado | ✓ | ✓ |
| `vibrate`, `image`, `silent`, `requireInteraction` | ✗ ignorados | ✓ | parcial |
| `setAppBadge` desde SW | ✓ | ✓ | ✓ |
| `notificationclick` + focus | ✓ | ✓ | ✓ |

## Dependencias

- Web Push API (browser).
- VAPID keys (suscritas via [[use-push]]).
- Backend: [[send-push-notification]] Edge Function.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| Quitar `event.waitUntil(showNotification)` | iOS revoca la suscripción tras 3 push silent → notifs dejan de llegar. |
| `tag = data.type` (sin itemId) | Shares consecutivos sobrescriben unos a otros en el Centro de Notificaciones. |
| Hardcodear `actions` aunque iOS los ignore | No es un problema — iOS los ignora silenciosamente. Mantener para Android. |
| Quitar `clientsList` check antes de openWindow | Click abre una nueva ventana aunque la PWA ya esté abierta → duplicación. |

## Notas / Changelog
- 2026-05-22: nivel medio.
