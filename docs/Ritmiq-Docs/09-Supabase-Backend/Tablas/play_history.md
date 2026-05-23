---
tipo: tabla
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
archivo: supabase/migrations/20260513000000_play_history_snapshot.sql
tags: [tabla, historial, snapshot, recomendaciones]
---

# `play_history`

> Historial de reproducciones. Diseño **snapshot**: cada evento guarda title/artist/cover propios para que tracks efímeros (no persistidos en `tracks`) también aparezcan en Home y stats.

## Schema (post-migración 20260513)

```sql
id                       uuid PK,
user_id                  uuid → auth.users(id) ON DELETE CASCADE,
track_id                 uuid → tracks(id) ON DELETE SET NULL,  -- nullable!
yt_id                    text,
title                    text NOT NULL,
artist                   text,
cover_url                text,
duration_seconds         int,
duration_played_seconds  int,
source                   text DEFAULT 'youtube',
played_at                timestamptz NOT NULL DEFAULT now()
```

## Por qué `track_id` nullable + snapshot

Tracks de search no persistidos (`yt:<id>`) no existen en `tracks` → `track_id` queda null pero el snapshot (`title`, `artist`, `cover_url`) basta para reconstruir el track al renderizar Home.

## RLS

Owner-only: `auth.uid() = user_id`.

## Cliente

- [[history]] store → `record(track, playedSeconds)` cuando se supera el umbral (30s o 30%).
- Selectores: `selectRecentTracks`, `selectTopTracks`, `selectTopArtists`, `selectContinueListening`, `selectStatsForPeriod`.

## Notas / Changelog
- 2026-05-07: schema inicial (FK obligatoria a tracks).
- 2026-05-13: migración a snapshot — track_id nullable + campos title/artist/cover/duration propios.
