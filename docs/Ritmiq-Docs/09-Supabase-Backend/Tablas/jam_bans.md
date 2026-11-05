---
tipo: tabla
capa: db
plataforma: backend
estado: estable
ultima-revision: 2026-11-04
archivo: supabase/migrations/20261104000000_jam_kick.sql
tags: [tabla, jam, rls]
---

# `jam_bans`

> Participantes expulsados de una jam: no pueden volver a entrar con el mismo código. Se crea para la TV como altavoz (ADR-043).

## Schema
```sql
create table public.jam_bans (
  session_id uuid not null references public.jam_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
```

## RLS y triggers
- `jam_bans: host all`: el host de la sesión lee/escribe; `jam_bans: self read`: el vetado ve su veto.
- `jam_participants_delete_host`: el host puede borrar a cualquiera de su sesión (expulsar).
- `jam_participants_insert_self` ahora exige no estar vetado.
- Trigger `jam_sessions_code_change`: al cambiar `jam_sessions.code` se borran los vetos de esa sesión.

Cliente: [[jam]] `kickParticipant(userId)` (upsert del veto + delete del participante) y `rotateCode()`. El expulsado detecta que su fila desapareció, sale y recibe el aviso `ritmiq:jam-kicked`.

## Notas / Changelog
- 2026-11-04: creación. Aplicada en producción el mismo día (Management API). Verificado: expulsar → el invitado sale con aviso; reintentar con el mismo código → «Te desconectaron de esta jam. Pide el código nuevo.» (comprobación previa en `joinSession`); con el código nuevo entra.
