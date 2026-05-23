---
tipo: flujo
capa: flujo
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
tags: [flujo, push, web-push, vapid, ios, streak]
---

# Push Notifications end-to-end

> Suscripción, persistencia en Supabase, envío via Edge Function, manejo de endpoints expirados.

## Diagrama de suscripción

```mermaid
sequenceDiagram
  participant U as Usuario
  participant UI as Settings
  participant Hook as use-push
  participant SW as Service Worker
  participant PM as PushManager
  participant SB as Supabase
  participant DB as push_subscriptions

  U->>UI: click "Activar notificaciones"
  UI->>Hook: requestPushPermissionAndRegister(userId)
  Hook->>Hook: Notification.requestPermission()
  alt usuario rechaza
    Hook-->>UI: false
  else usuario acepta (permission='granted')
    Hook->>SW: navigator.serviceWorker.ready
    Hook->>PM: pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: VAPID_PUBLIC })
    PM-->>Hook: PushSubscription { endpoint, p256dh, auth }
    Hook->>SB: UPSERT push_subscriptions (onConflict endpoint)
    SB->>DB: row creada/actualizada
    Hook-->>UI: true
  end
```

## Diagrama de envío (push automática tras share / friend request)

```mermaid
sequenceDiagram
  participant Edge1 as Edge send-share (o send-friend-request)
  participant Edge2 as Edge send-push-notification
  participant DB as push_subscriptions
  participant PushSvc as Push Service (FCM/APNs/Mozilla)
  participant SW as Service Worker PWA
  participant U as Usuario

  Edge1->>Edge1: INSERT shared_items
  Edge1->>Edge2: POST internal /send-push-notification { userId, title, body, data }
  Edge2->>DB: SELECT subs WHERE user_id
  loop por cada suscripción
    Edge2->>PushSvc: POST endpoint con payload VAPID-firmado
    alt 200/201 OK
      PushSvc->>SW: deliver push
      SW->>SW: registration.showNotification(title, options)
      SW-->>U: notif del SO
    else 404/410 (expirado)
      Edge2->>DB: DELETE WHERE endpoint (silencioso)
    else otro error
      Edge2->>DB: INSERT push_delivery_log (para diagnóstico)
    end
  end
```

## Diagrama de sync periódico (iOS edge cases)

```mermaid
sequenceDiagram
  participant Hook as use-push
  participant Notif as Notification.permission
  participant PM as PushManager
  participant DB as push_subscriptions

  Note over Hook: arranque o visibilitychange visible
  Hook->>Notif: permission?
  alt revocado externamente (Ajustes iOS)
    Hook->>PM: getSubscription
    Hook->>DB: DELETE WHERE endpoint
  else granted
    Hook->>PM: getSubscription
    alt no hay (Safari invalidó)
      Hook->>PM: subscribe() → nuevo endpoint
    else endpoint cambió
      Hook->>DB: UPSERT con nuevo endpoint
    end
  end
```

## Decisiones documentadas

- **`removePushDevice` vs `forgetPushDevice`** ([[use-push]]) — el primero solo borra DB (re-activable). El segundo llama `unsubscribe()` (iOS bloquea re-suscripción).
- **`requestPermission` debe estar en onClick** — iOS bloquea silenciosamente si se llama desde async.
- **Re-sync en `visibilitychange`** — detecta revocación de permiso fuera de la app.
- **`push_delivery_log` solo errores no-expirados** — 404/410 son esperados (browser limpia subs), no se loguean.
- **Streak reminders** ([[streak-reminder]]) — cron horario calcula timezone de cada usuario para enviar al mediodía y 9pm locales.

## Módulos involucrados

- UI: [[SettingsView]] sección notificaciones.
- Hook: [[use-push]], [[use-badge]] (badge del icono).
- Edge: [[send-push-notification]], [[send-share]], [[send-friend-request]], [[streak-reminder]].
- DB: [[push_subscriptions]], `push_delivery_log`.
- Service Worker: gestiona `pushevent` y `notificationclick`.

## Notas / Changelog
- 2026-05-22: F8.
