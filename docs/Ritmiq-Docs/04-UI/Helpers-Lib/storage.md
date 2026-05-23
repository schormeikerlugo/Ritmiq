---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/storage.js
tags: [helper, storage, imagen, portada, supabase]
---

# `lib/storage.js`

> Helpers de Supabase Storage para portadas de playlists. Upload con path único (timestamp) y compresión/resize de imagen via canvas.

## Ubicación
`packages/ui/src/lib/storage.js:1` (76 líneas)

## Exports

```js
async function uploadPlaylistCover({ userId, playlistId, blob, mime }): Promise<string>  // URL pública
function resizeImage(file: File, maxSize?: number = 800): Promise<{ blob, mime, dataUrl }>
```

## `uploadPlaylistCover`

- Path: `<userId>/<playlistId>-<Date.now()>.<ext>`
- Timestamp en el path = cache buster automático + no colisiona con subidas anteriores.
- `upsert: false` — cada subida es un archivo nuevo (no sobrescribe).
- Retorna la URL pública del bucket `playlist-covers`.

## `resizeImage`

- Canvas `<maxSize>×<maxSize>` (mantiene aspect ratio).
- Output JPEG calidad 0.85 — balance entre tamaño y calidad.
- Por qué no subir la imagen original: carátulas de cámara son 3-10MB. Subirlas directamente llenaría el bucket y cargarían lento en la UI.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| `upsert: true` | La segunda subida sobrescribe la primera, pero la URL anterior sigue siendo válida (mismo path) → portada no actualiza hasta que el navegador expira su caché. |
| Quitar timestamp del path | Dos subidas del mismo `playlistId` colisionan → fallo con `upsert: false`. |

## Notas / Changelog
- 2026-05-22: nivel simple.
