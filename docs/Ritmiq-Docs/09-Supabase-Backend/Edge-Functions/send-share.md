---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/send-share/index.ts
tags: [edge, social, share, shared-items, push]
---

# `send-share`

> Comparte un track o playlist con un amigo mutuo. Solo funciona entre amigos (`status='accepted'`). Inserta en `shared_items` y notifica via push.

## Ubicación
`supabase/functions/send-share/index.ts:1` (197 líneas)

## Endpoint

```
POST /send-share
Headers: Authorization: Bearer <JWT>
```

### Body para track

```ts
{
  receiverId: string,
  kind: 'track',
  ytId: string,
  title: string,
  artist: string,
  coverUrl: string,
  durationSeconds: number,
  message?: string,  // max 280 chars
}
```

### Body para playlist

```ts
{
  receiverId: string,
  kind: 'playlist',
  playlistName: string,
  playlistSnapshot: { tracks: [{ title, artist, ytId, ... }] },
  message?: string,
}
```

## Flujo

```
1. Auth: validar JWT.
2. Validar receiverId !== user.id, kind válido.
3. SELECT friendship WHERE status='accepted' AND (requester|addressee = sender, receiver) → 403 si no son amigos.
4. INSERT shared_items con sender_id, receiver_id, kind, datos.
5. Llamar send-push-notification al receiver.
```

## Snapshot completo en `playlistSnapshot`

El JSON del snapshot tiene la lista completa de tracks (con `ytId`, `title`, `artist`). Esto permite que el receptor:
- Pueda reproducir aunque la playlist original cambie después.
- Pueda guardarla como playlist propia con los tracks exactos del momento del share.

## Invocado desde
- [[social]] store → `sendShare(payload)`.
- [[ShareToFriendModal]] componente.

## Notas / Changelog
- 2026-05-22: nivel medio.
