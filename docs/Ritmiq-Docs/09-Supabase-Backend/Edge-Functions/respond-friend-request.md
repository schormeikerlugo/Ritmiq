---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/respond-friend-request/index.ts
tags: [edge, social, amistad, friendships]
---

# `respond-friend-request`

> Acepta, rechaza o bloquea una solicitud de amistad pendiente. Solo el `addressee` puede responder. Si acepta, notifica al `requester` via push.

## Ubicación
`supabase/functions/respond-friend-request/index.ts:1` (139 líneas)

## Endpoint

```
POST /respond-friend-request
Headers: Authorization: Bearer <JWT>
Body: { friendshipId: string, action: 'accept' | 'reject' | 'block' }
```

## Flujo

```
1. Auth: validar JWT.
2. SELECT friendship WHERE id = friendshipId.
3. Validar:
   - friendship.addressee === user.id (solo el destinatario responde).
   - status === 'pending' (excepto para 'block', que aplica desde cualquier estado).
4. UPDATE status a 'accepted' | 'rejected' | 'blocked'.
5. Si accept → llamar send-push-notification al requester ("X aceptó tu solicitud").
```

## Tabla `friendships`

```sql
status: 'pending' | 'accepted' | 'rejected' | 'blocked'
requester, addressee → references auth.users(id)
UNIQUE (LEAST(requester, addressee), GREATEST(requester, addressee))
```

## Invocado desde
- [[social]] store → `respondFriendRequest(friendshipId, action)`.

## Notas / Changelog
- 2026-05-22: nivel medio.
