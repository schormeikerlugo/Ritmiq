---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/TrackInfoDialog/TrackInfoDialog.jsx
tags: [componente, track, info, metadata, modal]
---

# `TrackInfoDialog`

> Modal de información técnica de un track: título, artista, álbum, duración, ytId, fuente, tamaño del archivo descargado, fecha de creación.

## Ubicación
`packages/ui/src/components/TrackInfoDialog/TrackInfoDialog.jsx:1` (271 líneas)

## Props

```js
{
  track: Track,
  onClose: () => void
}
```

## Datos mostrados

| Campo | Fuente |
|---|---|
| Título, artista, álbum | `track.*` |
| YouTube ID + link | `track.ytId` |
| Duración | `track.durationSeconds` formateado |
| Tamaño descargado | `api.libraryFileSize(track.id)` (async) |
| Fecha de guardado | `track.createdAt` |
| Fuente | `track.source` (`'youtube'` \| `'local'`) |

## Botones de acción inline

- "Abrir en YouTube" → `window.open(ytUrl)`.
- "Copiar ID" → [[share#copyToClipboard]].

## Render

Modal vía `createPortal` con [[Modal]] wrapper. En mobile usa [[BottomSheet]].

## Notas / Changelog
- 2026-05-22: nivel medio.
