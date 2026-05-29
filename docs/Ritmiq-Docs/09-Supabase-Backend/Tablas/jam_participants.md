---
tipo: tabla
capa: db
plataforma: backend
estado: estable
ultima-revision: 2026-05-29
archivo: supabase/migrations/20260528000001_jam_mode.sql
tags: [tabla, jam, realtime, rls, presence]
---

# `jam_participants`

> Tracking de quién está en cada [[jam_sessions]]. Cada user inserta su fila al unirse, actualiza `last_seen_at` cada 30s (heartbeat) y la borra al salir.

## Ubicación
`supabase/migrations/20260528000001_jam_mode.sql`

## Schema
```sql
create table public.jam_participants (
  session_id    uuid not null references public.jam_sessions(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);
```
PK compuesta `(session_id, user_id)` → un user = una fila por sesión.

## Realtime
```sql
alter publication supabase_realtime add table public.jam_participants;
```
El store re-fetch la lista entera en cualquier cambio (`event: '*'`).

## RLS
| Policy | Operación | Regla |
|---|---|---|
| `jam_participants_read` | SELECT | `true` |
| `jam_participants_insert_self` | INSERT | `auth.uid() = user_id` |
| `jam_participants_update_self` | UPDATE | `auth.uid() = user_id` (heartbeat) |
| `jam_participants_delete_self` | DELETE | `auth.uid() = user_id` (leave) |

## Casos de borde y gotchas
- **Cascade desde jam_sessions**: si el host borra la sesión, los participants se borran automáticamente.
- **Heartbeat 30s**: si un guest cierra la pestaña sin leave, su fila queda hasta el cleanup de la sesión (24h). No hay TTL por participante.
- **Re-fetch completo**: en cada cambio el store trae la lista entera. Aceptable porque el volumen es bajo (~10 participantes máx).

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Cambiar la PK compuesta | El upsert de join (`session_id` + `user_id`) duplica filas. |

## Dependencias entrantes
- [[jam|store jam]] (join/leave/heartbeat).

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 8).
