---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/export.js
tags: [helper, export, json, csv]
---

# `lib/export.js`

> Exportadores de playlists en JSON y CSV. Compatibles con Soundiiz y TuneMyMusic. Descarga el archivo via `<a download>`.

## Ubicación
`packages/ui/src/lib/export.js:1` (83 líneas)

## Exports

```js
function exportPlaylistJson(playlist: Playlist, tracks: Track[]): void
function exportPlaylistCsv(playlist: Playlist, tracks: Track[]): void
```

## Formato JSON

```json
{
  "name": "Mis Favoritas",
  "exportedAt": "2026-05-22T...",
  "tracksCount": 42,
  "tracks": [{ "title", "artist", "album", "durationSeconds", "source", "ytId", "coverUrl" }]
}
```

## Formato CSV (headers)

```
Title, Artist, Album, Duration, Source, YouTube ID
```

Sigue RFC 4180: campos con `,`, `"` o saltos de línea se entrecomillan con comillas dobles duplicadas.

## Mecanismo de descarga

```js
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.download = filename; a.href = url;
a.click();
setTimeout(() => URL.revokeObjectURL(url), 1000);
```

El object URL se revoca tras 1s para liberar memoria. Suficiente para que el browser descargue.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| No revocar el object URL | Memory leak acumulado por cada exportación en una sesión larga. |
| Quitar sanitización de filename (`safeFilename`) | Nombre de archivo con `/` o `:` → error del OS al guardar. |

## Notas / Changelog
- 2026-05-22: nivel simple.
