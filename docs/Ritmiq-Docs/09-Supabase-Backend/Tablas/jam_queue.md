---
tipo: tabla
capa: db
plataforma: backend
estado: estable
ultima-revision: 2026-05-31
archivo: supabase/migrations/20260531000000_jam_queue.sql
tags: [tabla, jam, realtime, rls, colaborativo]
---

# `jam_queue`

> Cola colaborativa de sugerencias de un [[jam_sessions|Jam]]. Cualquier participante sugiere canciones; el host decide qué suena, el orden y puede quitar cualquiera. Cada sugerencia queda identificada por quién la propuso (`suggested_by`) para mostrar su avatar + nombre. Ver flujo [[Jam-Mode]].

## Ubicación
`supabase/migrations/20260531000000_jam_queue.sql`

## Schema
```sql
create table public.jam_queue (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.jam_sessions(id) on delete cascade,
  suggested_by  uuid not null references auth.users(id) on delete cascade,
  track         jsonb not null,        -- { ytId, id, title, artist, album, coverUrl, durationSeconds }
  position      numeric not null default 0,  -- orden en la cola (el host reordena)
  played_at     timestamptz,           -- null = pendiente; set cuando el host la reproduce
  created_at    timestamptz not null default now()
);
```
Índices: `session_id`, `(session_id, position)`.

## Realtime
```sql
alter publication supabase_realtime add table public.jam_queue;
```
Los clientes escuchan INSERT/UPDATE/DELETE en el canal `jam-queue:<sessionId>`. El [[jam|store jam]] re-fetch la lista entera en cualquier cambio (volumen bajo).

## RLS
| Policy | Operación | Regla | Nota |
|---|---|---|---|
| `jam_queue_read` | SELECT | `true` | todos en la sesión ven la cola |
| `jam_queue_insert_participant` | INSERT | `auth.uid() = suggested_by` **y** existe fila en `jam_participants(session_id, uid)` | solo participantes sugieren, como sí mismos |
| `jam_queue_update_host` | UPDATE | `auth.uid() = (select host_id from jam_sessions where id = session_id)` | reordenar / marcar `played_at` = solo host |
| `jam_queue_delete_host_or_owner` | DELETE | host (cualquiera) **o** `suggested_by` si `played_at is null` | el autor quita su sugerencia no reproducida |

> El modelo respeta "host controla": las sugerencias son **propuestas**, no reproducción automática. El host reproduce con `playSuggestion` (marca `played_at` + aplica al player local, que se propaga por [[use-jam-sync]]).

## Casos de borde y gotchas
- **Cascade desde jam_sessions**: si el host cierra la sesión, la cola se borra automáticamente.
- **`position`**: el `suggestTrack` asigna `max+1` (orden de llegada). El reorder del host asigna una `position` nueva; el orden se recalcula al re-fetch (`order by played_at nulls first, position`).
- **Sin TTL propio**: las filas viven mientras viva la sesión (cleanup de 24h via cascade).
- **SELECT abierto**: igual que [[jam_sessions]], conociendo el código se puede leer la cola. Aceptable para uso personal/familiar.

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Quitar la tabla del `supabase_realtime` publication | Las sugerencias no aparecen en vivo; hay que reabrir el panel. |
| Relajar la policy UPDATE | Un guest podría reordenar/forzar reproducción, rompiendo el control del host. |

## Dependencias entrantes
- [[jam|store jam]] (`suggestTrack`, `removeSuggestion`, `reorderSuggestion`, `playSuggestion`, `_refreshSuggestions`).
- [[QueuePanel]] (UI contextual modo jam).

## Notas / Changelog
- 2026-05-31: tabla creada (Bloque 3.4 — cola colaborativa). Migración `20260531000000_jam_queue.sql` aplicada a producción vía API.
