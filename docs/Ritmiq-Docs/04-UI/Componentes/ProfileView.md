---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/ProfileView/ProfileView.jsx
tags: [componente, perfil, social, presencia, amistad]
---

# `ProfileView`

> Perfil público de un usuario. Avatar + bio + estado de amistad con botones de acción + "Escuchando ahora" si el usuario tiene `show_activity=true` y son amigos.

## Ubicación
`packages/ui/src/components/ProfileView/ProfileView.jsx:1` (479 líneas)

## Props

```js
{ userId: string }  // recibido desde view.userId
```

## Stores consumidos

| Store | Uso |
|---|---|
| [[social]] store | `friends`, `incomingRequests`, `outgoingRequests`, `friendsPresence`, `sendFriendRequest`, `respondFriendRequest` |
| [[auth]] store | `user` (para saber si es el propio perfil) |
| [[view]] store | `goBack`, `goFriends` |
| [[player]] store | `playNow` (si el amigo está escuchando algo) |

## Estados de amistad

| Estado | Botones disponibles |
|---|---|
| `'self'` | "Editar perfil" → goSettings |
| `'friend'` | "Amigos" (ya son amigos) |
| `'incoming'` | "Aceptar" / "Rechazar" |
| `'outgoing'` | "Solicitud enviada" (cancelable) |
| `'none'` | "Agregar amigo" |

## Presencia en vivo

Si el amigo tiene `friendsPresence.get(userId)` activo y `show_activity=true`:
```
"Escuchando ahora · Título · Artista"
[▶ Escuchar también]
```
Click en "Escuchar también" → `playNow([metaToCandidate(presenceEntry)])`.

## Datos del perfil

Carga el perfil vía consulta directa a Supabase (no via store):
```js
supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle()
```
Los perfiles son públicos (sin RLS restrictiva en esta tabla).

## Notas / Changelog
- 2026-05-22: nivel medio.
