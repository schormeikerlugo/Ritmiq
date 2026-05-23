---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/send-push-notification/index.ts
tags: [edge, push, web-push, vapid, interna]
---

# `send-push-notification`

> Función interna llamada por otras Edge Functions ([[send-friend-request]], [[send-share]], [[streak-reminder]]). Envía Web Push a TODAS las suscripciones del usuario. Limpia endpoints expirados (404/410). Loguea errores no esperados.

## Ubicación
`supabase/functions/send-push-notification/index.ts:1` (183 líneas)

## Endpoint

```
POST /send-push-notification
Body: { userId, title, body, data? }
```

**No expuesta al cliente** — solo a otras Edge Functions con service role.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `VAPID_PUBLIC_KEY` | Clave pública VAPID |
| `VAPID_PRIVATE_KEY` | Clave privada VAPID |
| `VAPID_SUBJECT` | `mailto:hola@ritmiq.app` |

## Flujo

```
1. SELECT push_subscriptions WHERE user_id = userId.
2. Si 0 subs → return { sent: 0, skipped: 'no_subscriptions' }.
3. Para cada sub: sendWebPush(endpoint, p256dh, auth_key, payload).
4. Clasificar resultados:
   - expired (404/410) → DELETE de la fila + no loguear.
   - error (otro status) → INSERT en push_delivery_log para diagnóstico.
   - ok → no loguear (volumen alto, sin valor).
```

## Por qué `npm:` specifier

```js
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
```

Cuando la función se deploya via Management API PATCH (no `supabase functions deploy`), Deno corre con `--no-remote` y rechaza imports de `esm.sh` o `deno.land/std`. El `npm:` specifier es la única forma compatible.

## Tabla `push_delivery_log`

Solo registra fallos no-expirados (errores reales que requieren diagnóstico). Limpieza periódica (no implementada — TODO).

## Notas / Changelog
- 2026-05-22: nivel medio.
