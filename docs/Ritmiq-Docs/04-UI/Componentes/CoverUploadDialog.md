---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/CoverUploadDialog/CoverUploadDialog.jsx
tags: [componente, cover, upload, imagen, storage]
---

# `CoverUploadDialog`

> Dialog de subida de portada para playlists. Permite seleccionar o arrastrar una imagen, la redimensiona a ≤800px JPEG 0.85 y la sube a Supabase Storage bucket `playlist-covers`.

## Ubicación
`packages/ui/src/components/CoverUploadDialog/CoverUploadDialog.jsx:1` (316 líneas)

## Props

```js
{
  playlistId: string,
  currentCoverUrl?: string,
  onClose: () => void,
  onSuccess: (url: string) => void
}
```

## Helpers consumidos

| Fuente | Uso |
|---|---|
| [[storage|ui/lib/storage]] | `resizeImage(file, 800)`, `uploadPlaylistCover({ userId, playlistId, blob, mime })` |
| [[supabase|ui/lib/supabase]] | Para obtener `userId` de la sesión |
| [[playlists]] store | `setCover(playlistId, url)` |

## Flujo

```
1. Drag-and-drop o file input → file seleccionado
2. Preview local inmediato (URL.createObjectURL)
3. resizeImage → canvas 800px → Blob JPEG 0.85
4. uploadPlaylistCover → Supabase Storage
5. setCover(playlistId, publicUrl)
6. onSuccess(publicUrl) → cierra dialog
```

## Validaciones

- Solo `image/*` (acepta JPEG, PNG, WebP, GIF).
- Max 5MB antes de resize.
- Si el resize falla → error visible.

## Notas / Changelog
- 2026-05-22: nivel medio.
