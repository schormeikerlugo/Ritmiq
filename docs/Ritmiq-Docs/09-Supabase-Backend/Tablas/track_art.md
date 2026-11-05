---
tipo: tabla
capa: db
plataforma: backend
estado: estable
ultima-revision: 2026-11-05
archivo: supabase/migrations/20261105000000_track_art.sql
tags: [tabla, portadas, rls]
---

# `track_art`

> Portada oficial y foto de artista por `yt_id`, resueltas por el servidor ([[Portadas]]). Global (no por usuario).

## Schema
`yt_id` PK · `status` ('found' | 'none') · `source` (itunes/deezer) · `score` · `matched_title` · `matched_artist` · `album` · `cover_url` (1000 px) · `cover_small_url` (300 px) · `artist_image_url` · `updated_at`.

## RLS
- Lectura: cualquier autenticado.
- Insert/update: solo `is_art_writer()` (security definer; cuentas en `prefetch_principals`, p. ej. servidor@ritmiq.org).

## Funciones
- `is_art_writer()`.
- `get_art_targets(p_limit)`: canciones de bibliotecas/historial sin fila aquí (más escuchadas primero), solo para escritores.

Las portadas elegidas a mano van en `tracks.cover_url` del usuario y ganan siempre.

## Notas / Changelog
- 2026-11-05: creación (aplicada en producción).
