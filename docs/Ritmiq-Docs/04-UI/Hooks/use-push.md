---
tipo: hook
capa: ui
plataforma: pwa
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-push.js
tags: [hook, push, notificaciones, pwa, ios, service-worker]
---

# `usePushRegistration(userId)` + helpers

> Registra y sincroniza la suscripción Web Push del dispositivo con Supabase. Diseñado para sobrevivir las particularidades de iOS PWA: drift detection, re-suscripción silenciosa, y separación entre "desactivar backend" y "olvidar dispositivo".

## Ubicación
`packages/ui/src/lib/use-push.js:1` (215 líneas)

## Exports

| Export | Tipo | Descripción |
|---|---|---|
| `usePushRegistration(userId)` | hook | Sync automático al arrancar y al volver de background |
| `requestPushPermissionAndRegister(userId)` | función async | Pedir permiso + registrar (llamar desde onClick) |
| `removePushDevice()` | función async | Borra fila en DB sin `unsubscribe()` local |
| `forgetPushDevice()` | función async | Borra fila en DB Y llama `unsubscribe()` — acción destructiva |
| `unregisterPush` | alias | Alias retro-compatible de `removePushDevice` |

## La distinción crítica: `removePushDevice` vs `forgetPushDevice`

```
removePushDevice():   DB DELETE solo → iOS puede re-suscribir silenciosamente
forgetPushDevice():   DB DELETE + sub.unsubscribe() → Safari BLOQUEA re-suscripción
```

**Por qué**: en iOS, una vez que llamas `sub.unsubscribe()`, Safari bloquea cualquier re-suscripción a `pushManager.subscribe()` sin un gesto explícito del usuario. Si el usuario toggle "Desactivar → Activar" dos veces, la segunda activación no funciona.

`removePushDevice` borra solo la fila de DB (el servidor deja de enviar pushes) pero mantiene la suscripción local viva → re-activar es un simple upsert sin pedir permiso de nuevo.

## Anatomía del código (snippets clave)

### 1. `syncSubscription`: 4 casos de reconciliación
`packages/ui/src/lib/use-push.js:149-162`

```js
async function syncSubscription(userId) {
  // Caso 1: permiso revocado externamente (Ajustes iOS)
  if (Notification.permission !== 'granted') {
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    }
    return;
  }
  // Casos 2-4: hay permiso → asegurar coherencia
  return registerPushSubscription(userId);
}
```

**Caso 1**: usuario fue a Ajustes iOS y revocó el permiso de Notificaciones. La suscripción local aún existe pero es inútil. Al volver a la app (`visibilitychange`), detectamos que el permiso se revocó y borramos la fila de DB.

**Caso 2**: permiso granted, no hay suscripción local (Safari la invalidó por inactividad). Se re-suscribe silenciosamente.

**Caso 3**: permiso granted, endpoint cambió (Safari puede rotar endpoints). Se hace upsert del nuevo endpoint.

**Caso 4**: estado consistente. No-op.

### 2. `requestPushPermissionAndRegister`: debe ser en onClick
`packages/ui/src/lib/use-push.js:68-79`

```js
export async function requestPushPermissionAndRegister(userId) {
  if (!isPushSupported()) return false;
  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') return false;
  return registerPushSubscription(userId);
}
```

**IMPORTANTE iOS**: `Notification.requestPermission()` DEBE ser llamado en respuesta directa a un `onClick`. Llamarlo desde `setTimeout`, `useEffect`, o cualquier contexto async que no sea un gesto es **silenciosamente bloqueado** por Safari. La app no recibirá ni éxito ni error.

### 3. `registerPushSubscription`: upsert por endpoint
`packages/ui/src/lib/use-push.js:164-198`

```js
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
```

**Por qué `onConflict: 'endpoint'`**: el mismo dispositivo puede llamar `registerPushSubscription` múltiples veces (arranque de app, visibilitychange). El upsert garantiza exactamente una fila por endpoint.

**Por qué `user_agent.slice(0, 200)`**: los User-Agent de iOS pueden ser largos. Limitamos para no exceder el límite de columna TEXT en Postgres.

## Casos de borde

- **Sin Service Worker registrado**: `isPushSupported` devuelve false → hook no-op.
- **Sin `VITE_VAPID_PUBLIC_KEY`**: `isPushSupported` devuelve false → no-op.
- **Múltiples tabs del mismo usuario**: cada tab llama `syncSubscription` al montar → múltiples upserts simultáneos del mismo endpoint → Supabase los serializa correctamente por el `onConflict`.
- **Reactivar push después de `forgetPushDevice`**: Safari bloquea → el botón de Ajustes debe redirigir al usuario a Ajustes iOS para re-conceder el permiso.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Usar `forgetPushDevice` en toggle "Desactivar" | El usuario no puede re-activar push sin ir a Ajustes iOS. |
| `requestPermission` fuera de onClick | iOS bloquea silenciosamente → botón no hace nada visible. |
| No re-sync en `visibilitychange` | Permiso revocado desde Ajustes iOS no se detecta → fila en DB queda sin borrar → errores en push delivery. |
| `onConflict` sin `endpoint` | Upserts simultáneos crean filas duplicadas → usuario recibe notificación duplicada. |

## Notas / Changelog
- 2026-05-22: nivel pleno. Documentadas las restricciones iOS de unsubscribe.
