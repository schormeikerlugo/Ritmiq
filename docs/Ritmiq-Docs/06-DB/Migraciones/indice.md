---
tipo: migracion
capa: supabase
plataforma: backend
estado: estable
ultima-revision: 2026-05-22
tags: [migraciones, indice, postgres]
---

# Índice de migraciones SQL

> 19 migraciones cronológicas en `supabase/migrations/`. Cada una se documenta junto a la tabla principal que afecta (en `09-Supabase-Backend/Tablas/`).

## Convenciones

- Nombre: `YYYYMMDDHHMMSS_descripcion.sql`.
- `pnpm supabase:reset` re-ejecuta todas en orden.
- `pnpm supabase:push` sube las nuevas a cloud.
- Idempotente cuando posible (`IF NOT EXISTS`, `OR REPLACE`).

## Línea temporal

| Fecha | Archivo | Cambio principal | Nota |
|---|---|---|---|
| 2026-05-07 | `initial_schema.sql` | `tracks`, `playlists`, `playlist_tracks`, `play_history`, bucket `covers`, triggers `updated_at`, RLS owner-only | [[tracks]], [[playlists]], [[play_history]] |
| 2026-05-08 | `playlist_covers.sql` | Bucket `playlist-covers` + columna `playlists.cover_url` | [[playlists]] |
| 2026-05-09 | `realtime.sql` | `ALTER PUBLICATION supabase_realtime ADD TABLE tracks, playlists, playlist_tracks` | habilita Realtime |
| 2026-05-10 | `tunnel_endpoints.sql` | Tabla `tunnel_endpoints` | [[tunnel_endpoints]] |
| 2026-05-11 | `tunnel_token.sql` | Columna `tunnel_endpoints.access_token` | [[tunnel_endpoints]] |
| 2026-05-13 | `play_history_snapshot.sql` | `track_id` nullable + columnas snapshot (title, artist, cover, duration_played) | [[play_history]] |
| 2026-05-14 | `recommendations.sql` | `recommendation_cache` (key: user_id+kind+seed, TTL 12h) | [[recommendation_cache]] |
| 2026-05-15 | `rec_cache_cron.sql` | Cron horario que limpia `recommendation_cache` con TTL excedido | — |
| 2026-05-16 | `artist_detail_cache.sql` | Cache de Last.fm artist-detail, TTL 24h | [[recommendation_cache]] |
| 2026-05-17 | `album_resolve_cache.sql` | Cache de album-resolve, TTL 7 días, key sha256 | [[recommendation_cache]] |
| 2026-05-21 | `profiles.sql` | Tabla `profiles` + trigger `on_auth_user_created` para crear perfil auto | [[profiles]] |
| 2026-05-21 | `friendships.sql` | Tabla `friendships` + VIEW `mutual_friends` | [[friendships]] |
| 2026-05-21 | `shared_items.sql` | Tabla `shared_items` (tracks y playlists compartidos) | [[shared_items]] |
| 2026-05-21 | `presence.sql` | Tabla `presence` con RLS friends-only + show_activity check | [[presence]] |
| 2026-05-21 | `push_subscriptions.sql` | Tabla `push_subscriptions` | [[push_subscriptions]] |
| 2026-05-22 | `avatars_bucket.sql` | Bucket `avatars` con RLS path-based | [[storage-buckets]] |
| 2026-05-22 | `push_delivery_log.sql` | Tabla `push_delivery_log` para errores no-expirados | [[push_subscriptions]] |
| 2026-05-23 | `streak_reminders.sql` | Tabla `streak_reminder_log` + cron horario para [[streak-reminder]] | [[streak_reminder_log]] |
| 2026-05-23 | `profiles_timezone.sql` | Columna `profiles.timezone` (IANA) para streak reminders por hora local | [[profiles]] |
| 2026-05-27 | `lyrics_cache.sql` | Tabla `lyrics_cache` (TTL letras) | [[lyrics_cache]] |
| 2026-05-27 | `daily_mix_cron.sql` | Cron diario de daily mix (prune + refresh via pg_net) | — |
| 2026-05-28 | `spotify_tokens.sql` | Tabla `spotify_tokens` (OAuth PKCE) | [[spotify_tokens]] |
| 2026-05-28 | `jam_mode.sql` | Tablas `jam_sessions` + `jam_participants` + Realtime + RLS + cron 24h | [[jam_sessions]], [[jam_participants]] |
| 2026-05-29 | `jam_roles.sql` | Columna `jam_participants.role` + RPC `jam_transfer_host` (pasar control) | [[jam_participants]] |

> Nota: este índice se actualizó parcialmente en F12 (entradas de F4-F8). Las migraciones de
> streaks/stream_url_cache/tracks_global anteriores a 2026-05-27 aún no están listadas aquí.

## Cómo añadir una migración

1. `supabase migration new <descripcion>` genera el archivo.
2. Escribir SQL idempotente.
3. `pnpm supabase:reset` para probar localmente.
4. `pnpm supabase:push` para aplicar a cloud.
5. Documentar en este índice + actualizar la nota de la tabla afectada.

## Notas / Changelog
- 2026-05-22: nivel simple. Consolidado en una sola nota índice.
