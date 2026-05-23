---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/send-friend-request/index.ts
tags: [edge, social, amistad, friendships, push]
---

# `send-friend-request`

> Crea una solicitud de amistad y envía push notification al destinatario. Maneja todos los casos de borde (ya amigos, ya pendiente, bloqueado, rechazada anterior).

## Ubicación
`supabase/functions/send-friend-request/index.ts:1` (165 líneas)

## Endpoint

```
POST /send-friend-request
Headers: Authorization: Bearer <JWT>
Body: { addresseeId: string }
```

## Respuesta

```
200 { friendship: { id, status } }
400 ya_amigos | ya_pendiente | bloqueado
404 usuario_no_encontrado
```

## Flujo

```
1. Auth: validar JWT, obtener requesterId.
2. Verificar addresseeId !== requesterId.
3. SELECT profiles WHERE user_id = addresseeId → 404 si no existe.
4. Buscar friendship existente entre los dos usuarios (en cualquier dirección).
5. Si existe:
   - 'accepted' → 400 ya_amigos
   - 'pending'  → 400 ya_pendiente
   - 'blocked'  → 400 bloqueado
   - 'rejected' → UPDATE a 'pending' (re-envío permitido)
6. Si no existe → INSERT 'pending'.
7. Llamar internamente send-push-notification al addressee.
```

## Push notification

Llama a [[send-push-notification]] con título "Nueva solicitud de amistad" + body con el username del requester.

## Invocado desde
- [[social]] store → `sendFriendRequest(addresseeId)`.

## Notas / Changelog
- 2026-05-22: nivel medio.
