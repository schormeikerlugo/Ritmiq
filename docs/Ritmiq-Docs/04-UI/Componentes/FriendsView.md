---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/FriendsView/FriendsView.jsx
tags: [componente, social, amigos, presencia, solicitudes, inbox]
---

# `FriendsView`

> Pantalla principal del sistema social. 4 tabs: Friends (presencia en vivo), Requests (solicitudes), Search (buscar usuarios), Inbox (items compartidos).

## Ubicación
`packages/ui/src/components/FriendsView/FriendsView.jsx:1` (972 líneas)

## Props
Sin props.

## Tabs

| Tab | Contenido |
|---|---|
| `'friends'` | Lista de amigos mutuos + "Escuchando ahora" via [[social#friendsPresence]] |
| `'requests'` | Entrantes (con botón Aceptar/Rechazar) + Enviadas (con botón Cancelar) |
| `'search'` | Input + lista de resultados de [[social#searchUsers]] |
| `'inbox'` | Items compartidos: tracks y playlists con actions (Reproducir/Guardar/Marcar leído) |

## Stores consumidos

| Store | Uso |
|---|---|
| [[social]] store | Todo: `profile`, `friends`, `friendsPresence`, `incomingRequests`, `outgoingRequests`, `inbox`, `loadFriends`, `loadRequests`, `loadInbox`, `sendFriendRequest`, `respondFriendRequest`, `sendShare`, `markInboxItemRead`, `markInboxItemSaved`, `searchUsers` |
| [[auth]] store | `user` |
| [[view]] store | `goBack`, `goProfile` |
| [[player]] store | `playNow` |

## Presencia en vivo

Cada amigo con presencia activa muestra:
```
"Escuchando ahora · Bohemian Rhapsody · Queen"
```
El hook [[use-social-realtime]] (montado en App) mantiene `friendsPresence` actualizado via Realtime. El badge de "Amigos" en [[BottomNav]] muestra `incomingRequests.length + inbox no leídos`.

## Badge + [[use-badge]]
Cuando el usuario está en esta vista, [[use-badge]] recibe `autoClearOnViewing=true` → badge del icono de la app se pone a 0.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| No marcar inbox como leído al abrir | Badge nunca se borra aunque el usuario lea los shares. |
| `loadFriends` sin cargar `profiles` por separado | `mutual_friends` VIEW sin FK → error de join en PostgREST. |

## Notas / Changelog
- 2026-05-22: nivel pleno.
