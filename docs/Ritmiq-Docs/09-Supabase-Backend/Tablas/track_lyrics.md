---
tipo: tabla
capa: db
plataforma: backend
estado: estable
ultima-revision: 2026-11-08
archivo: supabase/migrations/20261108000000_track_lyrics.sql
tags: [tabla, letras, rls]
---

# `track_lyrics`

> Letra sincronizada con el audio de cada `yt_id` ([[Letras-Sincronizadas]]).

`yt_id` PK · `status` ('found' | 'none') · `source` (youtube / offset / whisper) · `synced` (LRC) · `offset_ms` · `confidence` · `updated_at`.

RLS: lectura autenticados; escritura `is_art_writer()` (cuentas de servidor).

## Notas / Changelog
- 2026-11-08: creación (aplicada).
