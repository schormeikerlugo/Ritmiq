---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-download-status.js
tags: [hook, descargas, estado]
---

# `useDownloadStatus` / `useDownloadProgress`

> Dos hooks derivados que combinan el flag `isDownloaded` (biblioteca) con el estado efímero de la cola ([[downloads]] store) para calcular el estado correcto de una descarga.

## Ubicación
`packages/ui/src/lib/use-download-status.js:1` (25 líneas)

## Firmas

```js
function useDownloadStatus(trackId: string, isDownloaded: boolean):
  'idle' | 'queued' | 'running' | 'done' | 'error'

function useDownloadProgress(trackId: string): number  // 0..100
```

## Lógica de `useDownloadStatus`

```js
export function useDownloadStatus(trackId, isDownloaded) {
  const entry = useDownloadsStore((s) => s.entries.find((e) => e.trackId === trackId));
  if (entry?.status === 'running') return 'running';
  if (entry?.status === 'queued')  return 'queued';
  if (entry?.status === 'error')   return 'error';
  if (isDownloaded) return 'done';
  return 'idle';
}
```

**Por qué la cola gana sobre `isDownloaded`**: si un track está descargado (`isDownloaded: true`) pero acaba de ser enviado a la cola de nuevo (caso raro: re-descarga), el spinner debe mostrarse. El estado de la cola tiene prioridad.

**Por qué no hay `done` de la cola**: cuando la descarga termina, el store de downloads marca `status: 'done'` pero el estado canónico es `isDownloaded: true` en la biblioteca (que se refresca con `library.load()` tras la descarga). El `done` de la cola es transitorio.

## Uso típico

```jsx
const status = useDownloadStatus(track.id, track.isDownloaded);
// status === 'running' → mostrar spinner con progreso
// status === 'done'    → mostrar badge "offline"
// status === 'queued'  → mostrar spinner sin progreso
// status === 'error'   → mostrar icono error
// status === 'idle'    → mostrar botón "descargar"
```

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Invertir prioridad (isDownloaded antes que cola) | Track en descarga muestra badge "offline" en lugar de spinner. |

## Notas / Changelog
- 2026-05-22: nivel simple.
