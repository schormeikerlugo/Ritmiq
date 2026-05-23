---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/Downloads/Downloads.jsx
tags: [componente, descargas, offline, storage, indexeddb]
---

# `Downloads`

> Vista de tracks descargados offline. En PWA muestra blobs de IndexedDB; en Desktop muestra archivos descargados. Gestión de storage: estimación de uso, limpieza de cache.

## Ubicación
`packages/ui/src/components/Downloads/Downloads.jsx:1` (340 líneas)

## Props
Sin props.

## Stores y helpers consumidos

| Fuente | Uso |
|---|---|
| [[library]] store | `tracks` (para info de tracks), `load` |
| [[player]] store | `playNow`, `currentTrack`, `isPlaying` |
| [[local-downloads]] | `listLocalDownloads`, `storageEstimate`, `clearAllLocal` |
| [[api]] | `isDesktop`, `sharedCacheStats`, `sharedCacheClear` |

## Secciones

### PWA
- Lista de blobs descargados en IndexedDB con tamaño.
- `storageEstimate()` → barra de uso `X MB / Y GB disponibles`.
- Botón "Limpiar todo" → `clearAllLocal()`.

### Desktop
- Lista de archivos `.opus`/`.m4a` en `userData/audio/`.
- Stats de `shared_audio` (cache compartido entre cuentas) con botón "Limpiar caché compartido" → `api.sharedCacheClear()`.

## Pull-to-refresh

Recarga la lista de downloads locales y las estadísticas de storage al tirar.

## Formato de bytes

`fmtBytes(n)` convierte bytes a B / KB / MB / GB con 2 decimales para valores < 10.

## Notas / Changelog
- 2026-05-22: nivel medio.
