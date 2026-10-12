---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-10-12
archivo: supabase/migrations/20261012000000_streak_repairs.sql
tags: [tabla, streak, racha, recuperacion]
---

# `streak_repairs`

> Días LOCALES sin escucha que el usuario cubrió con un intento de recuperación de racha. [[Racha|compute_user_streak]] los cuenta como días activos.

## Schema

```sql
user_id       uuid → auth.users(id) ON DELETE CASCADE,
repaired_date date NOT NULL,          -- día local recuperado (tz del perfil)
used_at       timestamptz NOT NULL DEFAULT now(),  -- cuándo se gastó el intento
PRIMARY KEY (user_id, repaired_date)
```

1 fila = 1 intento gastado. Los intentos del mes = filas con `used_at` dentro del mes calendario actual en la timezone del usuario (límite 5).

## RLS

- `streak_repairs: owner read` — SELECT solo del dueño.
- Sin políticas de escritura: solo inserta `repair_streak()` (security definer).

## Funciones relacionadas

| Función | Acceso | Uso |
|---|---|---|
| `get_streak_repair_offer()` | `authenticated` | Oferta de recuperación del usuario actual |
| `repair_streak()` | `authenticated` | Gasta intentos, inserta días, recalcula `user_streaks` |
| `_streak_repair_offer(uuid)` | interna | Cálculo de la oferta |
| `_streak_day_active(uuid, date, text)` | interna | Día con play o recuperado |
| `_streak_user_tz(uuid)` | interna | Timezone del perfil (fallback UTC) |

## Cliente

Solo se usa vía RPC desde [[history]] (`loadRepairOffer`, `repairStreak`). Ver [[Racha]].

## Notas / Changelog
- 2026-10-12: creación (ADR-038).
