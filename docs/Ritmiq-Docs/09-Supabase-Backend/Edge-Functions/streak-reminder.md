---
tipo: edge-function
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/functions/streak-reminder/index.ts
tags: [edge, cron, push, streak, timezone]
---

# `streak-reminder`

> Cron horario que envía push de "no rompas tu racha" al mediodía y a las 9pm locales de cada usuario. Resuelve zonas horarias en backend para que cada usuario reciba el reminder en SU hora local.

## Ubicación
`supabase/functions/streak-reminder/index.ts:1` (284 líneas)

## Trigger

```
pg_cron: 0 * * * *   (cada hora exacta)
```

Disparada por el cron de Postgres con `net.http_post` al endpoint.

## Slots

| Hora local | Slot | Mensaje |
|---|---|---|
| 12:00 | `'noon'` | "Mantén tu racha 🔥 Tu mediodía musical te espera" |
| 21:00 | `'evening'` | "Quedan pocas horas para mantener tu racha de N días" |

## Anatomía del flujo

```
1. SELECT user_id FROM push_subscriptions (candidatos).
2. SELECT profiles.timezone IN (candidatos) → tzMap.
3. Para cada usuario:
   a) Calcular su hora local con Intl.DateTimeFormat({ timeZone: tz }).
   b) Si !== 12 y !== 21 → skip wrong_hour.
   c) Determinar slot ('noon' | 'evening').
   d) UNIQUE check en streak_reminder_log (slot, date_local).
   e) Calcular racha del usuario via play_history.
   f) Si racha < 1 → skip no_streak.
   g) Verificar si ya escuchó hoy → skip played.
   h) Llamar send-push-notification + INSERT log.
4. Return { processed, sent, skipped: { wrong_hour, played, no_streak, dup } }.
```

## Por qué el cron es global pero la hora es local

El cron de Postgres corre cada hora UTC. Sin esta lógica, todos los usuarios del mundo recibirían el reminder a la misma hora UTC → 7am en Madrid, 2am en Tokio, 1am en NY.

Calcular `Intl.DateTimeFormat({ timeZone })` por usuario hace que solo se envíe a los que están en su hora local objetivo.

## Skip conditions

| Condition | Razón |
|---|---|
| `wrong_hour` | La hora local del usuario no es 12 ni 21 |
| `played` | El usuario ya tiene play_history hoy → racha safe |
| `no_streak` | Racha < 1 → nada que perder |
| `dup` | Ya se envió este slot hoy (UNIQUE en log) |

## Body opcional para debugging

```
POST /streak-reminder
Body: { force: 'noon' | 'evening' }
```

Fuerza el slot ignorando la hora local. Solo para debug manual.

## Notas / Changelog
- 2026-05-22: nivel pleno.
