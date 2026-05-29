---
tipo: tabla
capa: db
plataforma: backend
estado: estable
ultima-revision: 2026-05-29
archivo: supabase/migrations/20260528000000_spotify_tokens.sql
tags: [tabla, spotify, oauth, tokens, rls]
---

# `spotify_tokens`

> Tokens OAuth de Spotify Web API por usuario (PKCE flow). El owner lee/borra; service role escribe via [[spotify-callback]]. Estado: aplicada en prod, pero el flow está inert hasta activar Spotify ([[Activar-Spotify-OAuth]]).

## Ubicación
`supabase/migrations/20260528000000_spotify_tokens.sql`

## Schema
```sql
create table public.spotify_tokens (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,   -- cuando vence access_token
  scope          text not null,           -- lista separada por espacios
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_spotify_tokens_expires on spotify_tokens(expires_at);
```

## RLS
| Policy | Operación | Regla |
|---|---|---|
| `spotify_tokens_owner_read` | SELECT | `auth.uid() = user_id` |
| `spotify_tokens_owner_delete` | DELETE | `auth.uid() = user_id` |
| (sin policy) | INSERT/UPDATE | Solo service role (bypasea RLS) desde [[spotify-callback]] |

**Por qué no hay policy INSERT/UPDATE**: solo el service role escribe (callback + futuro refresh). El owner nunca inserta directo.

## Casos de borde y gotchas
- **`refresh_token` no expira**: salvo revoke explícito del usuario en spotify.com/account/apps o ~1 año sin uso.
- **`expires_at` con margen**: [[spotify-callback]] resta 30s al `expires_in` para evitar usar el token justo al vencer.
- **`disconnectSpotify`** ([[spotify-oauth]]) borra la fila localmente, pero NO revoca en el lado de Spotify (el user debe ir a su panel).

## Dependencias entrantes
- [[spotify-callback]] (escribe).
- [[spotify-oauth]] (`getSpotifyConnectionStatus` lee, `disconnectSpotify` borra).
- Futura edge `spotify-recs` (leerá + refresh).

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Quitar `on delete cascade` de la FK | Borrar un user deja tokens huérfanos. |
| Cambiar PK de `user_id` | El `onConflict: 'user_id'` del upsert rompe. |

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 6.3).
