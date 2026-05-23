---
tipo: glosario
capa: meta
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
tags: [glosario]
---

# Glosario

Términos del dominio Ritmiq. Si un término aparece en varias notas, vive aquí y se referencia con `[[Glosario#término]]`.

## Reproducción

- **Track**: unidad mínima reproducible. Tiene `id`, `title`, `artist`, `duration`, `source` (yt / local / lan).
- **Queue**: cola de reproducción activa, gestionada por [[queue|core/queue]].
- **Source / stream URL**: URL temporal resuelta vía yt-dlp o `resolve-stream`. Caduca, requiere refresh.
- **MediaSession**: API del navegador / sistema para controles de medios (lockscreen, barras de notificación).
- **Crossfade**: mezcla suave entre el final de un track y el inicio del siguiente. Ver [[use-crossfade]].

## Almacenamiento

- **Library**: catálogo del usuario (tracks, playlists, álbumes, artistas favoritos).
- **Offline / Descarga**: archivo de audio guardado localmente (filesystem en desktop, IndexedDB en PWA).
- **Sync queue**: cola de operaciones pendientes de subir a Supabase cuando vuelve la conexión.

## Red

- **LAN streaming**: el desktop expone HTTP local para que la PWA en la misma red reproduzca sin internet.
- **Tunnel**: Cloudflared expone el LAN server a internet con URL pública temporal.
- **Pairing**: emparejamiento entre dispositivos del mismo usuario (token + descubrimiento mDNS o manual).

## Social

- **Share**: envío de un track/playlist a un amigo dentro de la app.
- **Presence**: estado online/escuchando, vía Realtime de Supabase.
- **Friendship**: relación bidireccional confirmada.

## Backend

- **Edge Function**: función Deno serverless en Supabase (`supabase/functions/*`).
- **RLS**: Row Level Security de Postgres; controla acceso por usuario.
- **Realtime**: canal websocket de Supabase para eventos en vivo.
