---
tipo: modulo
capa: ui
plataforma: ambas
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/html-audio-backend.js
tags: [helper, audio, webaudio, ios, eq, backend]
---

# `lib/html-audio-backend.js`

> Backend de audio nativo: un único `<audio>` HTMLMediaElement persistente + WebAudio graph lazy (EQ, Analyser, GainNode). Diseñado para iOS background playback. Implementa la interfaz `AudioBackend` de [[player|core/player]].

## Ubicación
`packages/ui/src/lib/html-audio-backend.js:1` (538 líneas)

## Por qué un solo `<audio>` para toda la sesión

iOS Safari mantiene la autorización para reproducir en background SOLO mientras el `<audio>` sigue activo en la sesión del gesto original. Crear/destruir elementos al cambiar de track rompe esa sesión → silencio en lockscreen. Ver [[use-player]] para el flujo completo.

## Export

```js
function createHtmlAudioBackend(): AudioBackend & {
  init(): void
  element(): HTMLAudioElement | null
  prepare(url): Promise<string>         // pre-fetch a blob URL
  swapAndPlay(url): void               // swap síncrono (para pre-end swap iOS)
  getAnalyser(): AnalyserNode | null
  getMasterGain(): GainNode | null
  audioContextState(): string
  initGraphFromGesture(): Promise<boolean>
  resumeContext(): Promise<void>
  setEqEnabled(enabled): void
  setEqGains(gainsDb: number[]): void
  getEqState(): { enabled, gains }
  isGraphReady(): boolean
}
```

## EQ Bands

```js
export const EQ_BANDS = [
  { freq: 60,    type: 'lowshelf',  q: 1.0, label: '60' },    // sub-bass
  { freq: 170,   type: 'peaking',   q: 1.0, label: '170' },   // bass
  { freq: 400,   type: 'peaking',   q: 1.0, label: '400' },   // low-mid
  { freq: 1000,  type: 'peaking',   q: 1.0, label: '1k' },    // mid
  { freq: 3500,  type: 'peaking',   q: 1.0, label: '3.5k' },  // high-mid
  { freq: 10000, type: 'highshelf', q: 1.0, label: '10k' },   // treble
];
```

`lowshelf`/`highshelf` en extremos porque controlan "todo lo que está por debajo/encima" de esa frecuencia → más natural para sub-bass y treble.

## Topología WebAudio

```
<audio> → MediaElementSource → masterGain ──[eqEnabled]──→ EQ[0]→...→EQ[5] ──→ AnalyserNode → destination
                                           ──[disabled]──→ AnalyserNode → destination
```

EQ bypass total cuando disabled: los filtros se desconectan del graph (`connectChain()`) → cero overhead de procesado.

## Anatomía del código (snippets clave)

### 1. `load()`: reset del elemento antes de asignar src (Safari/iOS)
`packages/ui/src/lib/html-audio-backend.js:301-335`

```js
load(url) {
  const el = ensureAudio();
  // CRÍTICO Safari/iOS: si asignamos src directamente mientras hay Range
  // requests en vuelo del track anterior, el decoder de iOS puede entrar en
  // estado corrupto → MEDIA_ERR_DECODE intermitente.
  // El reset (pause + removeAttribute + load) indica al elemento "empezar de cero".
  try {
    el.pause();
    el.removeAttribute('src');
    el.load();
  } catch {}
  return new Promise((resolve, reject) => {
    // Resolver en loadeddata (antes que canplay) → play() empieza más rápido.
    el.addEventListener('loadeddata', onCanPlay, { once: true });
    el.addEventListener('canplay', onCanPlay, { once: true });
    el.addEventListener('error', onError, { once: true });
    el.src = url;
    revokeAllExcept(url);
    currentSrc = url;
  });
},
```

**Por qué `loadeddata` antes que `canplay`**: `loadeddata` dispara cuando el primer frame de datos llega al decoder. En la práctica es suficiente para que `play()` funcione. `canplay` espera más datos y añade ~100-200ms de latencia percibida.

### 2. `play()`: resume del AudioContext antes de play
`packages/ui/src/lib/html-audio-backend.js:338-360`

```js
async play() {
  // FIX bug audio mute en background desktop:
  // Chromium en background suspende el AudioContext aunque el <audio> siga
  // ticking. Sus muestras pasan por el graph silenciado. Resume antes de play().
  if (ctx && ctx.state === 'suspended') {
    try { await ctx.resume(); } catch {}
  }
  await el.play();
},
```

**El bug**: con ventana desktop minimizada, el `<audio>` sigue avanzando (timeupdate dispara) pero el AudioContext está suspendido → el graph silencia la salida → audio en silencio. Resume explícito antes de cada play() lo resuelve.

### 3. `swapAndPlay`: swap SÍNCRONO para pre-end swap iOS
`packages/ui/src/lib/html-audio-backend.js:385-399`

```js
swapAndPlay(url) {
  const el = ensureAudio();
  // Resume del ctx EN PARALELO (sin await) para no romper el patrón síncrono
  // que permite a iOS preservar la sesión de background.
  if (ctx && ctx.state === 'suspended') {
    try { ctx.resume().catch(() => {}); } catch {}
  }
  el.src = url;
  revokeAllExcept(url);
  currentSrc = url;
  const p = el.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
},
```

**Por qué síncrono**: el pre-end swap de [[use-player]] ocurre a `duration - 0.4s` en un `timeupdate` (no en un gesto). iOS solo preserva la sesión si el nuevo `play()` se llama sincrónicamente después del `src=`. Un `await` rompería ese contrato.

### 4. `ensureGraphSync()`: crítico para iOS PWA + AudioContext
`packages/ui/src/lib/html-audio-backend.js:149-218`

```js
function ensureGraphSync() {
  // ...
  // CRÍTICO iOS PWA: si se llama desde dentro de un onClick directo,
  // iOS marca el AudioContext como "user gesture validated" y resume().
  // Si se llama tras un await, el gesto ya expiró → silencio total.
  try {
    return ctx.resume().then(() => ctx).catch(() => ctx);
  } catch {
    return Promise.resolve(ctx);
  }
}
```

**Patrón correcto de uso**:

```js
const onClickToggle = () => {
  // 1) Dispara la creación + resume EN LA MISMA STACK del click.
  const p = backend.initGraphFromGesture();
  // 2) await DESPUÉS — el gesto ya fue capturado en el paso 1.
  p.then(running => { if (running) backend.setEqEnabled(true); });
};
```

### 5. `crossOrigin = 'anonymous'` en `ensureAudio`
`packages/ui/src/lib/html-audio-backend.js:250-256`

```js
audio.crossOrigin = 'anonymous';
// CRÍTICO WebAudio + iOS: para que MediaElementSource pueda leer las
// muestras (necesario para EQ, AnalyserNode), el <audio> debe tener
// CORS validado. Sin esto, WebKit devuelve "zeroes due to CORS
// access restrictions" → silencio total cuando el graph está activo.
// DEBE setearse ANTES de cualquier src=...
```

**Por qué antes de cualquier `src`**: si se setea después de asignar el src, el browser puede haber iniciado la request sin las cabeceras CORS correctas → el `MediaElementSource` devuelve silencio.

## Casos de borde

- **Contexto histórico: `fallbackUrl` eliminado**: la función `load()` aceptaba un `opts.fallbackUrl` para reintentar con la URL del proxy si googlevideo daba 403. Se eliminó porque el camino directo siempre falla por IP-lock — el doble round-trip era pérdida de tiempo pura.
- **Blob URL leaks**: `liveBlobUrls` guarda todas las blob URLs creadas. `revokeAllExcept(currentUrl)` revoca las demás al cambiar de track. Si `dispose()` no se llama, hay leak de la última blob URL.
- **AudioContext en Safari mobile**: puede pasar a `suspended` silenciosamente sin `statechange`. El listener de `visibilitychange` en `if (typeof document !== 'undefined')` al module level hace resume al volver del background.

## Performance y costes

| Operación | Coste |
|---|---|
| `load(url)` | < 200ms (espera `loadeddata`) |
| `play()` | < 50ms |
| `swapAndPlay(url)` | < 5ms (síncrono) |
| WebAudio graph (si activo) | CPU adicional ~0.5% por frame |
| EQ disabled | Cero procesado (bypass total) |

## Dependencias entrantes
- [[use-player]] → crea y usa el backend para todo.
- [[use-crossfade]] → `element()` para acceso directo a `el.volume`.
- [[use-bpm-pulse]] → `getAnalyser()`.
- [[use-apply-audio-settings]] → `isGraphReady`, `setEqEnabled`, `setEqGains`.

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| `crossOrigin` seteado después del primer `src=` | EQ y Analyser devuelven silencio (CORS) → visualizer y EQ no funcionan. |
| `removeAttribute('src')` omitido en `load()` | En iOS, decode corruption intermitente al cambiar tracks rápidamente. |
| `swapAndPlay` con `await ctx.resume()` | Break del contrato síncrono → iOS no preserva la sesión de background. |
| Crear nuevo `<audio>` en cada `load()` | iOS pierde la sesión de background autorizada → silencio en lockscreen. |

## Notas / Changelog
- 2026-05-22: nivel pleno. Nota más crítica de F5 junto con api.md y lan-client.md.
