---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260521000004_push_subscriptions.sql
tags: [tabla, push, web-push, vapid]
---

# `push_subscriptions` + `push_delivery_log`

> Suscripciones Web Push del usuario. Una fila por endpoint (un usuario puede tener múltiples dispositivos). `push_delivery_log` registra errores no-expirados para diagnóstico.

## `push_subscriptions`

```sql
id          uuid PK,
user_id     uuid → auth.users(id) ON DELETE CASCADE,
endpoint    text NOT NULL UNIQUE,    -- URL única del push service del browser
p256dh      text NOT NULL,           -- clave pública del subscriber
auth_key    text NOT NULL,           -- secret del subscriber
user_agent  text,
platform    text,                    -- 'ios' | 'android' | 'desktop'
created_at  timestamptz,
updated_at  timestamptz
```

## `push_delivery_log`

```sql
id           uuid PK,
endpoint     text,
user_id      uuid,
status_code  int,
error_msg    text,
created_at   timestamptz
```

Solo se loguean errores **no expirados** (404/410 = endpoint muerto, se borra silenciosamente sin loguear).

## Limpieza de endpoints expirados

[[send-push-notification]] borra automáticamente filas cuyo endpoint devuelve 404 o 410.

## RLS

- SELECT: owner.
- INSERT/UPDATE: vía Edge Function (service role) tras upsert por endpoint.
- DELETE: owner o Edge Function.

## Cliente

- [[use-push]] hook → `usePushRegistration(userId)`, `requestPushPermissionAndRegister`, `removePushDevice`, `forgetPushDevice`.

## Notas / Changelog
- 2026-05-22: nivel simple.
