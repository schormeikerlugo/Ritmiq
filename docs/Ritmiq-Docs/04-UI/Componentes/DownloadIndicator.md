---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/DownloadIndicator/DownloadIndicator.jsx
tags: [componente, descarga, indicador, icono, estado]
---

# `DownloadIndicator`

> Indicador de estado de descarga por track (ícono pequeño en filas de lista). Usa [[use-download-status]] para combinar `isDownloaded` con el estado efímero de la cola.

## Ubicación
`packages/ui/src/components/DownloadIndicator/DownloadIndicator.jsx:1` (132 líneas)

## Props

```js
{
  trackId: string,
  isDownloaded: boolean,
  onDownload: () => void,  // callback cuando el usuario clickea descargar
}
```

## Estados visuales

| Status | Visual |
|---|---|
| `'idle'` | Ícono `ArrowDownToLine` (descargable) |
| `'queued'` | Spinner punteado |
| `'running'` | Spinner animado con porcentaje via [[use-download-progress]] |
| `'done'` | Ícono `CheckCircle` verde (descargado) |
| `'error'` | Ícono `AlertCircle` rojo |

## Notas / Changelog
- 2026-05-22: nivel simple.
