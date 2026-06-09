---
tipo: tabla
capa: db
plataforma: backend
estado: estable
ultima-revision: 2026-05-29
archivo: supabase/migrations/20260528000001_jam_mode.sql
tags: [tabla, jam, realtime, rls, cron]
---

# `jam_sessions`

> Sesiones de escucha colaborativa. El host envía comandos (current_track + position + is_playing) actualizando esta fila; los participantes los reciben via Realtime Postgres CDC. Ver flujo [[Jam-Mode]].

## Ubicación
`supabase/migrations/20260528000001_jam_mode.sql`

## Schema
```sql
create table public.jam_sessions (
  id                uuid primary key default gen_random_uuid(),
  host_id           uuid not null references auth.users(id) on delete cascade,
  code              text not null unique,           -- 6 chars uppercase, sin 0/O/1/I
  current_track     jsonb,                          -- { ytId, title, artist, coverUrl, durationSeconds }
  position_seconds  numeric not null default 0,
  is_playing        boolean not null default false,
  queue             jsonb not null default '[]',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```
Índices: `host_id`, `code`, `updated_at`.

## Realtime
```sql
alter publication supabase_realtime add table public.jam_sessions;
```
Los guests escuchan UPDATE/DELETE en el canal `jam:<sessionId>`.

## RLS
| Policy | Operación | Regla | Nota |
|---|---|---|---|
| `jam_sessions_read` | SELECT | `true` | cualquiera puede leer (join via code) |
| `jam_sessions_insert_self` | INSERT | `auth.uid() = host_id` | crear = ser host |
| `jam_sessions_update_host` | UPDATE | `auth.uid() = host_id` | **solo el host emite comandos** |
| `jam_sessions_delete_host` | DELETE | `auth.uid() = host_id` | cerrar sesión |

> ⚠️ La policy de SELECT es `using (true)` — cualquier authenticated puede leer **cualquier** sesión. Esto es intencional (join por código sin fricción) pero significa que conociendo un código de 6 chars se puede leer el track actual de una sesión. Para uso personal/familiar es aceptable. Documentado como gotcha en [[Jam-Mode]].

## Helpers SQL
- `generate_jam_code()`: 6 chars de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (excluye 0/O, 1/I para legibilidad en voz alta).
- `cron_cleanup_jam_sessions()`: borra sesiones con > 24h sin `updated_at`. Cron `ritmiq-cleanup-jam-sessions` a las 04:30 UTC.

## Casos de borde y gotchas
- **Host cierra app abruptamente**: la sesión queda "stale" hasta el cron de 24h. Los guests dejan de recibir updates pero la fila persiste.
- **`code` colisión**: el store reintenta hasta 5 veces (23505) generando otro código.

## Qué puede romper este cambio
| Cambio | Síntoma |
|---|---|
| Quitar la tabla del `supabase_realtime` publication | Los guests no reciben updates → sync rota. |
| Cambiar la policy UPDATE | Si se relaja, un guest podría secuestrar la reproducción. |

## Dependencias entrantes
- [[jam|store jam]] (CRUD + subscribe).
- [[jam_participants]] (FK).

## Notas / Changelog
- 2026-05-29: nota creada (F12, doc retroactiva de Fase 8).
- 2026-06-03 (**columna `kind`**, Bloque 3.8): `kind text not null default 'sync' check in
  ('sync','speaker')`. Tipo de jam: `sync` (todos reproducen en sync) o `speaker` (solo el host
  reproduce; los demás controlan a distancia). Migración `20260603000000_jam_kind.sql`. Ver
  [[Decisiones-Tecnicas-ADR|ADR-028]].
