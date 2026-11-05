---
tipo: modulo
capa: servidor
plataforma: server-core
estado: estable
ultima-revision: 2026-11-05
archivo: packages/server-core/src/art-resolver.js
tags: [portadas, servidor, cache, itunes, deezer]
---

# Portadas oficiales y fotos de artista

> El servidor identifica cada canción de YouTube y le asigna la **portada oficial** (iTunes/Deezer) y una **foto del artista** (Deezer). Lo guarda en disco y en Supabase para que la próxima vez cargue al instante en todos los dispositivos. ADR-044.

## Algoritmo (`art-resolver.js`)
1. **Limpieza** (`parseTrack`): fuera "(Official Video)", "[4K]", "Lyrics", "HD", "ft. …" y todo lo que va entre corchetes; separa "Artista - Título" (o "Título – Artista" si el canal coincide con la derecha); canal sin "- Topic"/"VEVO". Anota variantes (remix, live, acoustic, slowed, cover…). Si es ambiguo guarda una orientación alternativa.
2. **Búsqueda**: iTunes Search (`entity=song`, portada hasta 1000 px) + Deezer (`artist:"…" track:"…"`, portada 1000 px y foto de artista). Sin claves. Si la primera orientación no convence, se prueba la alternativa.
3. **Puntuación** (`scoreCandidate`, 0–1): título 55 % + artista 30 % + duración (±3 s +0,15; ±8 s +0,08; >20 s −0,15); −0,25 karaoke/cover/remix/directo que el original no tiene; −0,1 por variante del original ausente; −0,1 colaboraciones añadidas; −0,06 recopilatorios. Umbral `ACCEPT_SCORE = 0,62`.
4. Se usa el mejor candidato **cuya imagen se puede descargar** (algunos CDN de Deezer dan 403 por región). Foto del artista: la del candidato Deezer del mismo artista o búsqueda `search/artist`.
5. **Caché**: SQLite `art_cache` (también los "no encontrado", reintento al mes) + imágenes en `/data/art/<ytId>-cover1000.jpg`, `-cover300.jpg`, `-artist.jpg`.
6. **Publicación** en Supabase [[track_art]] con el JWT de la cuenta del servidor; si falla, `published=0` y se reintenta en cada pasada.

Cola en dos niveles: lo que piden las apps (`/art/resolve`, la que suena delante) cada 1,5 s; la pasada automática cada 3,5 s. Si iTunes limita (403/429), solo Deezer durante 1 min.

## Endpoints
| Ruta | Auth | Uso |
|---|---|---|
| `GET /art/track/<ytId>?s=300\|1000` | pública | imagen cacheada (`immutable`, 30 días); sin archivo → 302 al CDN; desconocida → 404 |
| `GET /art/artist/<ytId>` | pública | foto del artista |
| `POST /art/resolve` `{items, priority}` | device/owner (o compat) | encola y devuelve lo conocido |
| `GET /art/candidates?title&artist&duration` | device/owner (o compat) | "Buscar portada" (8 mejores) |

## Pasada automática (`apps/server`)
Cada 10 min: republica lo pendiente y encola hasta 150 canciones de `get_art_targets` (bibliotecas e historial sin `track_art`). `RITMIQ_ART_BACKFILL=false` lo apaga.

## Resultados (2026-11-05)
- Muestra de 40 canciones de la biblioteca real: 40/40 tras los ajustes (casos: títulos al revés, corchetes, remix vs instrumental, colaboraciones, recopilatorios).
- Pasada completa en curso: 631 encontradas, 44 sin resultado (≈ 93 %), 637 con foto de artista.
- Imagen servida por LAN: 300 px en ~14 ms, 1000 px en ~88 ms.
- Caso dudoso conocido: vídeos con duración de una versión distinta (p. ej. "Iris" 3:36 → single 3:19 con Steve Aoki). Se corrige con "Buscar portada".

## Clientes
Ver [[track-art]] (`useTrackCover`, `useArtistImage`, `TrackImg`) y `stores/art.js`.

## Notas / Changelog
- 2026-11-05: creación.
