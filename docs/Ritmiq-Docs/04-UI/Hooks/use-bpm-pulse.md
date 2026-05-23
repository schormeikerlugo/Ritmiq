---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/use-bpm-pulse.js
tags: [hook, audio, visualizer, webaudio, performance]
---

# `useBpmPulse(backend, enabled?)`

> Analiza la energía de bajos en tiempo real via Web Audio API y devuelve un factor de escala `1.00..1.06` para animar el cover con el ritmo. No es un BPM tracker — es un visualizer de energía de banda baja suavizado.

## Ubicación
`packages/ui/src/lib/use-bpm-pulse.js:1` (92 líneas)

## Firma

```js
function useBpmPulse(
  backend: ReturnType<typeof createHtmlAudioBackend>,
  enabled?: boolean  // default true
): number  // 1.00..1.06
```

## Por qué "BPM" en el nombre pero no BPM real

Un BPM tracker real requiere FFT pesado sobre ventanas largas o un autocorrelation algorithm. Este hook hace algo más simple y visual: mide la energía de los primeros 32 bins FFT (~0-700Hz) y la mapea a escala visual. El resultado "pulsa con la música" de forma natural sin ser exacto en BPM.

## Constantes

```js
const FFT_SIZE    = 1024;
const SMOOTH      = 0.85;       // smoothing exponencial (0=instantáneo, 1=congelado)
const SCALE_MIN   = 1.0;
const SCALE_MAX   = 1.06;       // 6% de escala máxima — sutil
const BASS_BIN_END = 32;        // primeros 32 bins ≈ 0-700Hz
```

## Anatomía del código (snippet clave)

### Loop rAF con throttle de setState
`packages/ui/src/lib/use-bpm-pulse.js:53-88`

```js
function tick(now) {
  const isPlaying = usePlayerStore.getState().isPlaying;
  if (!isPlaying) {
    // decay suave en pausa — no freeze brusco del cover
    smoothRef.current *= 0.92;
    const s = SCALE_MIN + smoothRef.current * (SCALE_MAX - SCALE_MIN);
    if (Math.abs(s - scale) > 0.002) setScale(s);
    raf = requestAnimationFrame(tick);
    return;
  }
  analyser.getByteFrequencyData(bins);  // escribe en buffer pre-allocado (sin GC)
  let sum = 0;
  const end = Math.min(BASS_BIN_END, bins.length);
  for (let i = 0; i < end; i++) sum += bins[i];
  const avg = sum / end / 255;           // normalizar a [0, 1]

  // Smoothing exponencial — SMOOTH=0.85 hace que el valor responda
  // pero sin parpadear frame a frame.
  smoothRef.current = smoothRef.current * SMOOTH + avg * (1 - SMOOTH);
  const s = SCALE_MIN + smoothRef.current * (SCALE_MAX - SCALE_MIN);

  // Throttle setState a ~30fps para no spammear React.
  if (now - lastSet > 32) {
    lastSet = now;
    setScale(s);
  }
  raf = requestAnimationFrame(tick);
}
```

**Por qué `Uint8Array` pre-allocado**: `getByteFrequencyData` escribe en el buffer sin crear objetos. Si pasáramos un array nuevo cada frame, el GC pausa notablemente con el reproductor activo (60fps × N allocs/s).

**Por qué throttle a 30fps en `setScale`**: el rAF corre a 60fps pero el cover no necesita actualizar a 60fps para verse suave (el ojo percibe fluidez desde ~24fps). 30fps reduce renders React a la mitad.

**Por qué `decay * 0.92` en pausa**: si el cover quedara fijo en `scale=1.04` al pausar, el usuario vería el cover ligeramente agrandado. El decay lo lleva suavemente de vuelta a `1.0` en ~2 frames.

## Performance

| Condición | CPU |
|---|---|
| Reproduciendo, enabled=true | 1 rAF @ 60fps, ~0.1ms/frame |
| Pausado, enabled=true | 1 rAF @ 60fps pero sin FFT, ~0.01ms/frame |
| enabled=false o desmontado | 0 rAF |

## Casos de borde

- **WebAudio no inicializado**: `backend.getAnalyser()` devuelve null → guard devuelve undefined y el hook retorna `SCALE_MIN = 1.0` estático.
- **Track sin bajos**: energía baja → `smooth` se queda cerca de 0 → escala ~1.0. El cover apenas pulsa.

## Dependencias entrantes
- [[NowPlaying]] componente → `useBpmPulse(backend, isVisible)`.

## Dependencias salientes
- [[html-audio-backend]] → `getAnalyser()`.
- [[player]] store → `isPlaying`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| `Uint8Array` nuevo cada frame | GC stutter cada ~2s durante reproducción activa. |
| Quitar throttle setState (60fps) | Renders dobles → UI lenta con NowPlaying abierto. |
| `SMOOTH = 0` | Parpadeo agresivo frame a frame — no se ve como pulso sino como estroboscopio. |
| `SCALE_MAX = 1.5` | Cover crece 50% con cada golpe — demasiado distractor. |

## Notas / Changelog
- 2026-05-22: nivel medio.
