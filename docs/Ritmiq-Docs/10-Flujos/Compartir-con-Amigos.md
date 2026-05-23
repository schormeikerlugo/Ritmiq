---
tipo: flujo
capa: flujo
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [flujo, social, share, push, realtime]
---

# Compartir un track con un amigo

> Sender comparte → Edge Function valida amistad → INSERT en `shared_items` → push notification al receiver → Realtime actualiza su inbox → reminder si no se lee.

## Diagrama

```mermaid
sequenceDiagram
  participant Sender
  participant UI as ShareToFriendModal
  participant Soc as social store
  participant SS as Edge send-share
  participant SP as Edge send-push-notification
  participant DB as Supabase shared_items
  participant Receiver
  participant RT as use-social-realtime
  participant SR as use-share-reminder

  Sender->>UI: selecciona amigo + mensaje
  UI->>Soc: sendShare({ receiverId, kind: 'track', ... })
  Soc->>SS: POST /send-share
  SS->>DB: SELECT friendships WHERE status='accepted'
  alt no son amigos
    SS-->>Soc: 403
    Soc-->>UI: error → hapticError
  else son amigos
    SS->>DB: INSERT shared_items
    SS->>SP: POST internal /send-push-notification
    SP->>DB: SELECT push_subscriptions WHERE user_id = receiverId
    SP->>SP: sendWebPush a cada endpoint
    SS-->>Soc: 200
    Soc-->>UI: hapticSuccess + cerrar
  end

  par push al receiver
    SP-->>Receiver: notificación SO ("X te compartió Bohemian Rhapsody")
  and Realtime al inbox
    DB->>RT: INSERT event en shared_items
    RT->>RT: useSocialStore.loadInbox(userId)
    RT-->>Receiver: inbox actualizado en UI
  end

  alt receiver clickea push
    Receiver->>UI: abre Ritmiq → goFriends → FriendsView inbox
    UI->>Soc: markInboxItemRead(id)
  else receiver ignora push
    Note over SR: tras 2 min sin leer
    SR->>SR: useShareReminderStore.show([item])
    SR->>Receiver: modal ShareReminder
  end
```

## Decisiones documentadas

- **Validación de amistad en Edge** ([[send-share]]) — RLS no basta porque requiere lógica de pares ordenados.
- **Push + Realtime juntos** — push captura usuarios con app cerrada, Realtime actualiza UI si está abierta.
- **Reminder client-side** ([[use-share-reminder]]) — cubre el caso de push perdida o ignorada.
- **Playlist snapshot completo** ([[shared_items]]) — el receptor reproduce aunque la playlist original cambie después.
- **`message` max 280 chars** — convención compartida (UI valida, Edge re-valida con slice).

## Módulos involucrados

- UI: [[ShareToFriendModal]], [[ShareReminder]], [[FriendsView]].
- Estado: [[social]] store, [[use-share-reminder]].
- Edge: [[send-share]], [[send-push-notification]].
- DB: [[shared_items]], [[push_subscriptions]], [[friendships]].
- Realtime: [[use-social-realtime]] canal `shared_items`.

## Notas / Changelog
- 2026-05-22: F8.
