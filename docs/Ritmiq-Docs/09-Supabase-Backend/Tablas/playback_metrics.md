---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-10-12
archivo: supabase/migrations/20261012000200_playback_metrics.sql
tags:
  - tabla
  - telemetria
  - reproduccion
  - rendimiento
---

# `playback_metrics`

> Tiempo desde que el player empieza a cargar una canción hasta que suena (o falla). Mide con datos reales cada mejora de reproducción.

## Schema

```sql
id          bigint identity PK,
user_id     uuid NOT NULL DEFAULT auth.uid() → auth.users ON DELETE CASCADE,
yt_id       text,
ms_to_play  int NOT NULL CHECK (0..600000),
origin      text,   -- origen de resolveAudioSource (server, lan, tunnel, cloud, local-blob…)
platform    text,   -- ios | android | desktop
outcome     text NOT NULL DEFAULT 'playing' CHECK (playing | error),
created_at  timestamptz NOT NULL DEFAULT now()
```

Índice `playback_metrics_created_idx (created_at desc)`.

## RLS

- `owner insert`: `auth.uid() = user_id`.
- `owner read`: `auth.uid() = user_id`.

## Cliente

`packages/ui/src/lib/playback-metrics.js` `recordPlaybackMetric()` (fire-and-forget), llamado desde [[use-player]] `loadAndPlayCurrent`.

## Consultas útiles

```sql
select platform, outcome, count(*),
       percentile_cont(0.5) within group (order by ms_to_play) p50,
       percentile_cont(0.9) within group (order by ms_to_play) p90
from playback_metrics where created_at > now() - interval '7 days'
group by 1, 2 order by 1, 2;
```

El desglose disco/progresivo lo da el log del servidor (`SHARED HIT` / `PROGRESSIVE`).

## Notas / Changelog
- 2026-10-12: creación (ADR-039).
