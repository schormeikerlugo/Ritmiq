---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260523000000_streak_reminders.sql
tags: [tabla, cron, streak, log, dedup]
---

# `streak_reminder_log`

> Log de envíos de [[streak-reminder]]. Garantiza que cada usuario reciba como mucho 1 push por slot por día.

## Schema

```sql
id           uuid PK,
user_id      uuid → auth.users(id) ON DELETE CASCADE,
slot         text CHECK (slot IN ('noon','evening')),
date_local   date NOT NULL,
sent_at      timestamptz NOT NULL DEFAULT now(),
UNIQUE (user_id, slot, date_local)
```

## Dedup via UNIQUE

El UNIQUE `(user_id, slot, date_local)` garantiza que aunque el cron se ejecute dos veces el mismo día (retry, debug, drift de la hora), solo un reminder llega al usuario por slot.

`date_local` se calcula con el timezone del usuario, NO con UTC del server.

## Cliente

Solo escrita desde [[streak-reminder]] Edge Function (service role).

## Limpieza

No hay limpieza automática (los logs son pequeños, ~2 filas por usuario por día). Cron futuro podría borrar entradas > 90 días.

## Notas / Changelog
- 2026-05-22: nivel simple.
