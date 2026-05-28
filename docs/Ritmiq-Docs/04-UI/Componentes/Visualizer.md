---
tipo: componente
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/components/NowPlaying/Visualizer.jsx
tags: [componente, visualizer, canvas, webaudio, analyser, now-playing]
---

# `<Visualizer>`

> Canvas espectral de 48 barras logarítmicas en [[NowPlaying]]. Lee `getByteFrequencyData()` del `AnalyserNode` compartido con [[use-bpm-pulse]]. Modo "demo" fallback con `Math.sin()` si el WebAudio graph no está disponible.

## Ubicación
`packages/ui/src/components/NowPlaying/Visualizer.jsx:1` (~210 líneas)

## Props

```js
<Visualizer enabled={visualizerEnabled && !!currentTrack} />
```

| Prop | Tipo | Notas |
|---|---|---|
| `enabled` | `boolean` | Si `false`, retorna `null` y limpia el rAF activo |

## Stores consumidos

| Fuente | Uso |
|---|---|
| [[player]] store | `isPlaying` (lee dentro del rAF, no via subscribe) |
| [[html-audio-backend]] | `getSharedBackend().getAnalyser()` |
| [[settings]] store | `visualizerEnabled` (en el padre [[NowPlaying]]) |

## Setup técnico

| Constante | Valor |
|---|---|
| `NUM_BARS` | 48 |
| `FFT_SIZE` | 512 |
| `SMOOTH` | 0.5 (exponential smoothing) |
| `PAUSE_DECAY` | 0.92 (decay frame en pausa) |
| `ATTACH_INTERVAL_MS` | 1000 |
| `MAX_ATTACH_ATTEMPTS` | 10 |

## Buckets logarítmicos

```js
function buildBarBuckets(numBins) {
  // Espaciado log2 desde minIdx=1 (skip DC bin) hasta maxIdx
  // Asi las barras agudas no se aplastan
}
```

Sin esto, las primeras 6-8 barras (bajos) ocuparían casi toda la animación y los agudos serían imperceptibles.

## Modo "demo" fallback

Si `analyser === null` (graph no inicializado o `getSharedBackend()` undefined), dibuja barras sintéticas:

```js
const t = (now - startTs) / 1000;
const base = 0.18 + 0.12 * Math.sin(t * 1.5 + i * 0.35);
smoothed[i] = smoothed[i] * 0.85 + (isPlaying ? base : base * 0.35) * 0.15;
```

Sirve como **puerta trasera visual**: el usuario ve que el toggle hizo algo aunque algo falle. Se reemplaza automáticamente por audio real cuando `tryAttachAnalyser` conecta.

## Polling de attach

`tryAttachAnalyser` se llama al mount. Si `getAnalyser()` devuelve null, programa un re-intento en 1s. Máximo 10 intentos (10s total). Una vez attach, no se repite.

## ResizeObserver

```js
const ro = new ResizeObserver(() => resizeCanvas());
ro.observe(canvas);
```

Cuando el canvas cambia de tamaño (cambio de vista, abrir/cerrar paneles laterales, rotación mobile), reinicia `width`/`height` con HiDPI scale + recrea el `gradient`.

## Pausa con decay

```js
if (!isPlaying) {
  for (let i = 0; i < NUM_BARS; i++) smoothed[i] *= PAUSE_DECAY;
}
```

Las barras decaen suavemente hacia 0 conservando su última forma. Transición play→pause se siente fluida, no cortada.

## Performance

- 1 `requestAnimationFrame` mientras `enabled=true`.
- `getByteFrequencyData` escribe en `Uint8Array` pre-allocado (sin GC).
- `clearRect` + N `fillRect` (o `roundRect` si soportado) sin recrear el gradient por frame.
- 60Hz objetivo; throttle automático del browser cuando la ventana queda oculta.

## HiDPI

```js
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.floor(rect.width * dpr);
canvas.height = Math.floor(rect.height * dpr);
ctx.scale(dpr, dpr);
```

Sin esto, en pantallas Retina las barras se ven blur.

## Cómo se activa

[[NowPlaying]] footer → botón `Sparkles` → `handleVisualizerToggle`:

1. Llama `backend.initGraphFromGesture()` sincrónicamente (captura el gesto).
2. Si init OK → `setVisualizerEnabled(true)`.
3. Si init falla → `toast.error` y el state queda igual.

Ver [[Decisiones-Tecnicas-ADR|ADR-015]].

## Qué rompe esto

| Cambio | Impacto |
|---|---|
| Subir `NUM_BARS` a 96+ | CPU notable en mobile bajo |
| Quitar el modo demo | Si algo falla, canvas transparente confunde al usuario |
| Quitar el polling | Si el graph se crea después (otro toggle), Visualizer no se conecta |
| Cambiar `FFT_SIZE` (debe ser potencia de 2) | Re-calibrar buckets |

## Casos de borde

- **`enabled=true` pero `getSharedBackend()` undefined** (SSR): polling falla 10 veces → modo demo permanente. Aceptable.
- **Track sin audio o silencio absoluto**: `bins` son todos 0 → barras planas a `height: 2px` (Math.max defensivo).
- **`roundRect` no soportado** (Chrome 99-): fallback a `fillRect` rectangular sin esquinas redondeadas. Funcional.

## Changelog

- 2026-05-27 — Creado en Fase 4.5 (commit `5f7ec2e`). FIX.1 + FIX.2 + FIX.3 mismos día: auto-init del graph (`ba887a2`), modo demo + ResizeObserver (`08f2677`), mover toggle al footer (`f79cefb`).
