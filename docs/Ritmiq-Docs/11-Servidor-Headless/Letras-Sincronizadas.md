---
tipo: modulo
capa: servidor
plataforma: server-core
estado: estable
ultima-revision: 2026-11-08
archivo: packages/server-core/src/lyrics-sync.js
tags: [letras, whisper, gpu, youtube]
---

# Letras sincronizadas por vídeo

> Prioridad: **siempre una letra con tiempos que cuadren con el audio que suena**. ADR-046.

## Orden (cliente `stores/lyrics.js` → servidor)
1. `track_lyrics` (Supabase, por `yt_id`): letra ya sincronizada con ese vídeo.
2. Función [[lyrics]] (LRCLIB, búsqueda amplia): se usa si su `duration` difiere ≤ 3 s del vídeo.
3. Si no cuadra o solo hay texto → `POST /lyrics/sync` al servidor; el cliente vuelve a mirar `track_lyrics` a los 8/20/45/90/150 s. Mientras: texto que baja según el avance ("Letra sin sincronizar" / "Sincronizando…"). Si el servidor no lo logra y LRCLIB difiere ≤ 15 s, se usa tal cual.

## Servidor (`lyrics-sync.js`, cola de 1 tarea)
1. **Subtítulos manuales del vídeo** (yt-dlp `-J` + `--write-subs --sub-format json3`; YouTube exige tokens que yt-dlp resuelve). Se aceptan si comparten ≥ 50 % del vocabulario con la letra conocida (descarta traducciones). Tiempos exactos del vídeo. Ej.: "As It Was" (48 líneas).
2. **Whisper** (`whisper-align.js`, whisper.cpp + modelo medium q5 en `/data/models`, ~540 MB, se descarga solo):
   - *offset*: letra de otra versión → cada línea se busca en las palabras reconocidas; las no encontradas usan su tiempo + desfase mediano.
   - *align*: letra sin tiempos → mismas búsquedas; huecos interpolados. Se descarta si < 40 % de líneas encontradas.
   - Audio: shared-audio; si falta se pide la descarga y se espera ≤ 3 min.
3. Resultado → `track_lyrics` (`source` youtube/offset/whisper, `confidence`) + SQLite `lyrics_jobs` ("none" se reintenta a los 14 días).

## GPU (AMD RX 570)
- whisper.cpp con **Vulkan** (ROCm no soporta Polaris). Etapa `whisper` del `apps/server/Dockerfile` (Debian 12 + SPIRV/Vulkan-Headers de Khronos `vulkan-sdk-1.4.309.0`); runtime `libvulkan1 mesa-vulkan-drivers libgomp1`.
- `docker-compose.yml`: `devices: /dev/dri` y `group_add: 992 (render), 44 (video)` del host.
- Medido: "As It Was" (2:47) 20 s; "Dinero y Poder" (4 min, rap) 47 s. `RITMIQ_WHISPER=off` lo desactiva.

## Precisión medida ("As It Was", referencia = subtítulos)
- Solo texto: 43/47 líneas encontradas, error mediano 0,7 s.
- Desfase forzado de 7,3 s: calculado 7,96 s (la diferencia es el adelanto habitual del subtítulo sobre la voz).

## Notas / Changelog
- 2026-11-08: creación.
