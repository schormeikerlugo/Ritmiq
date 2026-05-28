---
tipo: hook
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-27
archivo: packages/ui/src/lib/use-crossfade.js
tags: [hook, crossfade, audio, fade, background]
---

# `useCrossfade(backend)`

> Fade-in del volumen al cambiar de track. **No es crossfade real** (sin solapamiento de audios) — es un fade-in rápido cuando el nuevo track empieza. Si `crossfadeSeconds === 0`, es no-op.

## Ubicación
`packages/ui/src/lib/use-crossfade.js:1` (128 líneas)

## Por qué no es crossfade real

Crossfade real requiere dos `<audio>` simultáneos + WebAudio graph + reescritura del flujo del [[use-player]]. El flujo actual es delicado por iOS background playback. Un fade-in simple aporta el 80% del UX (transición suave) sin tocar lo que funciona.

## Firma

```js
function useCrossfade(backend: AudioBackend): void
```

## Decisión de implementación crítica: `setInterval` sobre `requestAnimationFrame`

`packages/ui/src/lib/use-crossfade.js:74-96`

```js
// CRÍTICO desktop background: usamos setInterval, NO requestAnimationFrame.
//
// Bug previo: con la ventana Electron minimizada y crossfadeSeconds > 0,
// el track auto-next sonaba EN SILENCIO hasta abrir la ventana de nuevo.
//
// Causa raíz: rAF está atado al ciclo vsync de la ventana. Cuando la ventana
// se minimiza, Chromium pausa el compositor y los rAF NO se ejecutan.
// backgroundThrottling: false NO cubre esto — ese flag solo desactiva
// throttling de TIMERS (setTimeout/setInterval), no del compositor.
//
// Síntoma: fadeIn() seteaba el.volume = 0 → rAF encolado pero no corría
// → <audio> avanzaba con volume=0 → reproducción en silencio total.
// Al traer la ventana: rAF se reanudaba → fade completaba → volvía el sonido.
//
// Fix: setInterval @ 33ms. Cubierto por backgroundThrottling:false.
```

```js
const id = setInterval(() => {
  const t = Math.min(1, (performance.now() - startTime) / durMs);
  const eased = 1 - Math.pow(1 - t, 3);  // ease-out cubic
  try { el.volume = targetVol * eased; } catch {}
  if (t >= 1) {
    try { el.volume = targetVol; } catch {}
    clearInterval(id);
  }
}, 33);
```

**Ease-out cubic**: el fade comienza rápido y desacelera al final, lo que el oído percibe como más natural que lineal.

## Anatomía del código (snapshot clave)

### Cancelar fade anterior al cambiar track
`packages/ui/src/lib/use-crossfade.js:51-52`

```js
cancelFade();
intervalRef.current = fadeIn(backend, seconds);
```

**Por qué**: si el usuario cambia de track muy rápido (next → next → next), sin cancelar, se acumularían N intervalos modificando `el.volume` simultáneamente → comportamiento errático del volumen.

### No opera si `crossfadeSeconds === 0`
`packages/ui/src/lib/use-crossfade.js:34-37`

```js
if (seconds <= 0) {
  lastTrackIdRef.current = state.currentTrack?.id ?? null;
  return;  // no-op
}
```

**Por qué**: aunque el default sea 0 en [[settings]], el hook sigue suscripto al store. El guard garantiza cero overhead cuando la feature está desactivada.

## Casos de borde

- **Backend null al montar**: guard `if (!backend) return`.
- **Cambio de track mientras ya hay fade en curso**: `cancelFade()` limpia el interval anterior antes de iniciar el nuevo.
- **Volumen objetivo <= 0.01**: `if (targetVol <= 0.01) return null` — no iniciar fade si el usuario está en mute.

## Dependencias entrantes
- [[App]] (o donde se monte el engine) pasa el backend.

## Dependencias salientes
- [[player]] store → `subscribe` para detectar cambio de track.
- [[settings]] store → `getState().crossfadeSeconds`.
- [[html-audio-backend]] → `element()` para acceso directo a `el.volume`.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Cambiar `setInterval` a `requestAnimationFrame` | Fade silenciado con ventana Electron minimizada → canción siguiente empieza en silencio. |
| No cancelar fade anterior | Múltiples intervalos modificando volume simultáneamente → volumen errático al cambiar tracks rápido. |
| Quitar ease-out cubic | Fade lineal → el inicio del track suena "abrupto" en lugar de suave. |

## Notas / Changelog
- 2026-05-22: nivel pleno. Documentado el bug de rAF en background y el fix con setInterval.
- 2026-05-27 (Fase 4.3): añadido **fade-out** cuando `positionSeconds` entra en `dur - crossfadeSeconds`. Ahora compone dos fades:
  1. fade-OUT al final del track (subscribe a `state.positionSeconds`).
  2. fade-IN al cambiar `currentTrack` (lo que ya hacía).
  Flag `fadeOutStartedRef` evita disparos repetidos. Nueva función `fadeOut(backend, seconds)` con `ease-in cubic`. Ver [[Decisiones-Tecnicas-ADR|ADR-012]]. Commit `1890ecf`.
