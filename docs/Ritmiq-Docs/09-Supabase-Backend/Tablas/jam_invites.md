---
tipo: tabla
capa: db
plataforma: backend
estado: estable
ultima-revision: 2026-06-01
archivo: supabase/migrations/20260601000000_jam_invites.sql
tags: [tabla, jam, social, realtime, rls, invitaciones]
---

# `jam_invites`

> Invitaciones a un Jam enviadas a amigos (Bloque 3.6). El **host** invita a un amigo mutuo a su jam; el receptor la ve en su pestaña Solicitudes (+ toast realtime + push). Si acepta hace `joinSession(code)`; si rechaza, le llega un push al host. Ver flujo [[Jam-Mode]].

## Ubicación
`supabase/migrations/20260601000000_jam_invites.sql`

## Schema
```sql
create table public.jam_invites (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references auth.users(id) on delete cascade,  -- host que invita
  receiver_id  uuid not null references auth.users(id) on delete cascade,  -- amigo invitado
  session_id   uuid not null references public.jam_sessions(id) on delete cascade,
  code         text not null,                 -- snapshot del codigo de la jam
  status       text not null default 'pending'
                 check (status in ('pending','accepted','rejected','cancelled')),
  responded_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint jam_invites_no_self check (sender_id <> receiver_id)
);
```
Índices: `receiver_id`, `sender_id`, parcial `where status='pending'`.

## Realtime
`replica identity full` + añadida a `supabase_realtime`. [[use-social-realtime]] suscribe:
- INSERT `receiver_id=eq.<me>` → nueva invitación (recarga + toast accionable "Unirse").
- UPDATE `sender_id=eq.<me>` → la invitación fue aceptada/rechazada (toast al host en reject).

## RLS (6 policies)
| Policy | Operación | Regla |
|---|---|---|
| receiver read | SELECT | `auth.uid() = receiver_id` |
| sender read | SELECT | `auth.uid() = sender_id` |
| sender insert | INSERT | `auth.uid() = sender_id` **y** existe friendship `accepted` entre ambos |
| receiver update | UPDATE | `auth.uid() = receiver_id` (accept/reject) |
| sender update | UPDATE | `auth.uid() = sender_id` (cancelar) |
| participant delete | DELETE | sender o receiver |

> La validación fuerte (amistad mutua + caller es host de la jam) la hace además la edge
> function [[send-jam-invite]]; la RLS de INSERT exige al menos amistad aceptada.

## Edge functions
- [[send-jam-invite]]: valida amistad + que el caller es host de `session_id`, inserta la fila, push `type='jam_invite'` con el `code`. Dedupe de pendientes.
- [[respond-jam-invite]]: el receptor accept/reject; en **reject** push `type='jam_invite_rejected'` al host.

## Casos de borde y gotchas
- **Cascade**: si la jam (`jam_sessions`) se cierra, las invitaciones se borran.
- **Dedupe**: `send-jam-invite` no crea una 2ª invitación pendiente a la misma persona/jam.
- **Jam vacía**: la jam se crea al invitar (modelo "al invitar"); si nadie acepta, se limpia con el cron de 24h.

## Dependencias entrantes
- [[social|store social]] (`loadJamInvites`, `sendJamInvite`, `respondJamInvite`).
- [[FriendsView]] (botón Invitar + tarjetas en Solicitudes).
- [[use-social-realtime]] (4º canal).

## Notas / Changelog
- 2026-06-01: tabla creada (Bloque 3.6 — invitaciones de jam via Amigos). Migración `20260601000000_jam_invites.sql` aplicada a producción; functions `send-jam-invite`/`respond-jam-invite` desplegadas.
