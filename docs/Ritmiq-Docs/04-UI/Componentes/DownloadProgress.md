---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-08-11
archivo: packages/ui/src/components/DownloadProgress/DownloadProgress.jsx
tags: [componente, descarga, progreso, pildora, floating]
---

# `DownloadProgress`

> Indicador GLOBAL de descargas — **píldora compacta** (no invasiva) abajo-derecha. Muestra el agregado (anillo de progreso + "Descargando N/M"). El detalle por-track vive en [[DownloadIndicator]] (spinner en cada fila).

## Ubicación
`packages/ui/src/components/DownloadProgress/DownloadProgress.jsx`

## Props
Sin props. Montado a nivel raíz en `App.jsx` (dentro de `.shell`).

## Stores consumidos

| Store | Uso |
|---|---|
| [[downloads]] store | `entries`, `visible`, `hide`, `clearFinished` |

## Comportamiento (rediseño 2026-08 — píldora)

- **Píldora** de una línea: anillo SVG de progreso + label (`Descargando N/M` /
  `Descargas listas` / `Listo · N/M` con fallos) + `%` + botón ×.
- **Tocar la píldora** expande la lista detallada (barras por-track); oculta por
  defecto. La lista crece **hacia arriba** (`flex-direction: column-reverse`).
- **Posición**: por ENCIMA del reproductor fijo y del bottom-nav en móvil
  (`bottom: calc(var(--player-h) + var(--bottom-nav-h) + space-3)`, vars
  heredadas de `.shell`) — antes tapaba el botón de play.
- Auto-oculta 2.5s tras terminar todo (`clearFinished` + `hide`).

## Por qué el rediseño

El panel anterior era una tarjeta fija de 340px con una barra por track que
tapaba una esquina durante toda la operación (reporte: "muy invasivo"). Es
redundante con el [[DownloadIndicator]] por fila que ya existe. Ver ADR de
descargas y el store [[downloads]].

## Notas / Changelog
- 2026-08-11: rediseño a píldora compacta + reposicionado sobre el reproductor.
- 2026-05-22: nivel simple (panel de 340px, deprecado).
