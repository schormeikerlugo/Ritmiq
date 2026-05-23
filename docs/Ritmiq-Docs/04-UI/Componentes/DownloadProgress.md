---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/components/DownloadProgress/DownloadProgress.jsx
tags: [componente, descarga, progreso, barra, floating]
---

# `DownloadProgress`

> Barra flotante de progreso de descargas activas. Se muestra cuando `useDownloadsStore().visible === true`. Lista todas las entradas de la cola con su estado/progreso.

## Ubicación
`packages/ui/src/components/DownloadProgress/DownloadProgress.jsx:1` (233 líneas)

## Props
Sin props.

## Stores consumidos

| Store | Uso |
|---|---|
| [[downloads]] store | `entries`, `visible`, `hide`, `clearFinished` |

## Comportamiento

- Aparece desde la parte inferior (slide-up) cuando `visible`.
- Botón "×" → `hide()` (oculta el panel, las descargas siguen).
- Botón "Limpiar" → `clearFinished()` (elimina entradas done/error).
- Cada entrada muestra: título + barra de progreso animada + estado textual.
- Auto-colapsa cuando todas las entradas están en `done` + `error` (sin running/queued).

## Notas / Changelog
- 2026-05-22: nivel simple.
