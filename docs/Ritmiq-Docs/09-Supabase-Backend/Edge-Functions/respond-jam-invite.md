---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-06-01
archivo: supabase/functions/respond-jam-invite/index.ts
tags: [edge, social, jam, invitaciones, push]
---

# `respond-jam-invite`

> El receptor acepta o rechaza una invitación a jam. En **accept** devuelve el `code` para que el cliente haga `joinSession(code)`. En **reject** notifica al host via push (`type='jam_invite_rejected'`).

## Ubicación
`supabase/functions/respond-jam-invite/index.ts`

## Endpoint
```
POST /respond-jam-invite
Headers: Authorization: Bearer <JWT>
Body: { inviteId, action: 'accept' | 'reject' }
→ { invite: { id, status, code } }
```

## Validaciones
1. La invitación existe y `receiver_id === caller`.
2. `status === 'pending'` (no responder dos veces).
3. Actualiza `status` + `responded_at`.

## Push (solo en reject)
`type='jam_invite_rejected'` al `sender_id` (host) con `badgeCount` recomputado. En **accept** no se manda push (el host ve al amigo entrar por Realtime de [[jam_participants]]).

## Dependencias
- Tablas: [[jam_invites]], `profiles`.
- Llama a `send-push-notification`.
- Cliente: [[social|store social]] `respondJamInvite` → [[jam|store jam]] `joinSession`.

## Notas / Changelog
- 2026-06-01: creada (Bloque 3.6). Desplegada a producción.
