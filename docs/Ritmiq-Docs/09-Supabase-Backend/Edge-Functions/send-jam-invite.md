---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-06-01
archivo: supabase/functions/send-jam-invite/index.ts
tags: [edge, social, jam, invitaciones, push]
---

# `send-jam-invite`

> Invita a un amigo mutuo a una jam ya creada. El caller debe ser el **host** de esa jam. Inserta en [[jam_invites]] y notifica al receptor via push (`type='jam_invite'`).

## Ubicación
`supabase/functions/send-jam-invite/index.ts`

## Endpoint
```
POST /send-jam-invite
Headers: Authorization: Bearer <JWT>
Body: { receiverId, sessionId }
→ { invite: { id, code, createdAt } }
```

## Validaciones
1. `receiverId !== caller`.
2. **Amistad mutua** (`friendships status='accepted'` via `.or()`).
3. La jam existe y `host_id === caller` (solo el host invita).
4. **Dedupe**: no crea otra invitación pendiente a la misma persona/jam.

## Push
`type='jam_invite'`, `data.code` (para joinSession), `badgeCount` = invitaciones de jam pendientes + shares no leídos + solicitudes de amistad pendientes. SW: [[Actualizaciones|sw-push]] añade actions "Ver"/"Ahora no" y enruta a `/?openTab=requests`.

## Dependencias
- Tablas: [[jam_invites]], [[jam_sessions]], `friendships`, `profiles`.
- Llama a `send-push-notification`.
- Cliente: [[social|store social]] `sendJamInvite`.

## Notas / Changelog
- 2026-06-01: creada (Bloque 3.6). Desplegada a producción.
