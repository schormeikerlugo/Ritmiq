---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/search-users/index.ts
tags: [edge, social, busqueda, usuarios, profiles]
---

# `search-users`

> Búsqueda de perfiles por `@username` (prefijo) o email exacto. Devuelve `friendshipStatus` con cada resultado para que la UI sepa si mostrar "Agregar amigo", "Pendiente" o "Amigos".

## Ubicación
`supabase/functions/search-users/index.ts:1` (130 líneas)

## Endpoint

```
GET /search-users?q=<query>&limit=10
```

| `q` | Búsqueda |
|---|---|
| `@arctic` | username con prefijo `arctic` (ILIKE) |
| `ana@example.com` | email exacto en `auth.users` (requiere service role) |
| `arctic` | username con prefijo `arctic` (ILIKE, sin `@`) |

## Respuesta

```ts
{
  users: [{
    userId, username, displayName, avatarUrl,
    friendshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'blocked',
  }]
}
```

## Por qué service role para email

`auth.users.email` no es accesible vía PostgREST normal (requiere admin). Para buscar por email exacto usamos `svc.auth.admin.listUsers()`. Mitiga el riesgo: solo búsqueda exacta (no prefix) para no permitir enumeración.

## Límites

- `q.length < 2` → vacío.
- `limit` clamped a 20.
- Sin rate limit explícito (TODO: migrar a Redis cuando crezca).

## Invocado desde
- [[social]] store → `searchUsers(query)`.
- [[FriendsView]] tab `'search'`.

## Notas / Changelog
- 2026-05-22: nivel medio.
