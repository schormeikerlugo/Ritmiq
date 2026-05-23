---
tipo: modulo
capa: ui
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: packages/ui/src/lib/howler-backend.js
tags: [helper, audio, howler, desktop, backend]
---

# `lib/howler-backend.js`

> Backend de audio basado en Howler.js que implementa la interfaz `AudioBackend` de [[player|core/player]]. Usado en Desktop (Electron). La PWA usa [[html-audio-backend]].

## Ubicación
`packages/ui/src/lib/howler-backend.js:1` (96 líneas)

## Por qué Howler en Desktop y no HTML Audio

Howler provee más control de formato y un API más estable en Electron/Chromium. En iOS/Safari, el `<audio>` singleton de [[html-audio-backend]] es crítico para la sesión de background — Howler no garantiza ese contrato en iOS.

## Export

```js
function createHowlerBackend(): AudioBackend
```

## `AudioBackend` implementado

```js
{
  load(url): Promise<void>
  play(): Promise<void>
  pause(): void
  seek(sec): void
  setVolume(v): void
  onEnded(cb): () => void
  onPosition(cb): () => void
  duration(): number
  dispose(): void
}
```

## Polling de posición

Howler no emite eventos continuos de posición. El backend usa `setInterval(250ms)` mientras el Howl está `playing()` para llamar los callbacks `onPosition`. Se detiene con `stopPolling()` al pausar o descargar.

## `html5: true` en Howl

```js
howl = new Howl({
  src: [url],
  html5: true,        // NECESARIO para streaming / archivos largos
  format: ['opus', 'm4a', 'mp3', 'webm'],
})
```

**Por qué `html5: true`**: sin él, Howler intenta cargar el archivo completo en Web Audio como ArrayBuffer. Para un track de 5MB vía stream, eso tardaría segundos antes de que empezara el audio. Con `html5: true`, usa un HTMLAudioElement debajo y hace streaming real.

## Diferencias con [[html-audio-backend]]

| Aspecto | howler-backend | html-audio-backend |
|---|---|---|
| Backend | Howler.js | HTMLAudioElement nativo |
| WebAudio graph | No | Sí (lazy: EQ, AnalyserNode) |
| `swapAndPlay` | No | Sí (pre-end swap iOS) |
| MediaSession API | No | Sí (gestionada por [[use-player]]) |
| iOS background | No garantizado | Sí (diseñado para iOS) |
| Plataforma | Desktop | PWA + Desktop |

## Qué puede romper este cambio

| Cambio | Síntoma |
|---|---|
| `html5: false` | Howler carga el archivo completo en RAM → latencia alta para tracks > 1MB. |
| Quitar `stopPolling()` en `pause()` | El interval sigue corriendo aunque pausado → CPU desperdiciada + callbacks en posición estática. |

## Notas / Changelog
- 2026-05-22: nivel medio. **Nota**: En la práctica la UI usa [[html-audio-backend]] incluso en Desktop (ver [[use-player]]). Este backend podría estar en desuso — verificar si el Desktop lo instancia en algún contexto actual.
