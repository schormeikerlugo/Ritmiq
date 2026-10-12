---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-10-12
archivo: packages/ui/src/lib/use-loading-bar.js
tags:
  - hook
  - reproduccion
  - ux
  - carga
---

# `use-loading-bar.js`

> La barra de tiempo hace de **barra de carga** mientras la canción carga, para que el usuario vea cuánto tarda. Al sonar salta al 100% ("Listo en X s") y vuelve a ser la barra de tiempo.

## API

```js
const { phase, pct, elapsedMs } = useLoadingBar();
// phase: 'idle' | 'loading' | 'done'
formatLoadingSeconds(2300) // '2,3 s'
```

- **loading**: `pct = 95 · (1 − e^(−t/2500ms))` (≈52% a 2 s, 76% a 4 s, 89% a 7 s): el total no se conoce, así que la curva nunca llega al final por sí sola. `elapsedMs` = tiempo real (tick 100 ms).
- **done**: 600 ms al 100% con el tiempo total final. Solo si terminó sin error.
- **idle**: barra de tiempo normal.

## Fuente de verdad

`stores/player.js` `isLoading` + `loadingStartedAt`, que fija [[use-player]] `loadAndPlayCurrent` (inicio → `true`; `play()` OK o error final → `false`). También se limpia en crossfade, Jam y al vaciar la cola.

## Consumidores

- [[Player]]: mini barra móvil (`miniProgressFill[data-loading]`) y barra completa (`.bar[data-loading]`, sin seek ni thumb); contador `1,4 s` / `Listo en 2,6 s` en el tiempo izquierdo (ancho fijo, desborda a la izquierda para no mover la barra).
- [[NowPlaying]]: scrubber (`.scrubInput[data-loading]`, deshabilitado) y "Cargando 1,4 s".

Brillo animado (`loading-shine`), desactivado con `prefers-reduced-motion`.

## Notas / Changelog
- 2026-10-12: creación (petición del usuario: ver cuánto tarda en cargar una canción).
