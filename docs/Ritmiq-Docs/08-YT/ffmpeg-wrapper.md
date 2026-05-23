---
tipo: modulo
capa: yt
plataforma: desktop
estado: wip
ultima-revision: 2026-05-22
archivo: packages/yt/src/ffmpeg-wrapper.js
tags: [yt, ffmpeg, placeholder]
---

# `yt/ffmpeg-wrapper.js`

> Wrapper mínimo para ffmpeg. **Placeholder** — hoy yt-dlp invoca a ffmpeg internamente para la conversión de audio. Este módulo existe para tareas futuras (recortes, fade, normalización ReplayGain, transcodificación manual).

## Ubicación
`packages/yt/src/ffmpeg-wrapper.js:1` (29 líneas)

## Estado actual

`estado: wip` — no se usa en producción hoy. yt-dlp recibe `--audio-format opus|m4a` y orquesta la conversión con el ffmpeg del sistema internamente, sin que el código de Ritmiq lo invoque directamente.

## Firma

```js
function ffmpeg(args: string[]): Promise<string>  // stdout o throw
```

Spawn de `ffmpeg` con los args dados, captura stdout + stderr.

## Código completo

`packages/yt/src/ffmpeg-wrapper.js:16-29`

```js
export function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
    });
  });
}
```

**Diferencia con [[ytdlp-wrapper#run]]**: no tiene `promise.kill` adjunto. No hay sistema de prioridades para ffmpeg hoy. Si se usa en producción, añadirlo.

## Casos de uso futuros planeados

- Normalización de volumen (ReplayGain / loudness normalization).
- Fade in/out configurable.
- Recorte de tracks (comienzo y fin en segundos).
- Transcodificación a MP3 para exportación.

## Dependencias salientes
- `node:child_process.spawn`.
- `ffmpeg` en `$PATH` o bundleado.

## Qué monitorizar al activar en producción

- ffmpeg no está bundleado en el AppImage hoy — asume que está en PATH del usuario. Si no está instalado, spawn emite `error` con `ENOENT`. Añadir detección similar a [[ytdlp-path]] si se productiviza.
- Sin `promise.kill`: operaciones largas (ej. normalización de 1h de audio) no pueden cancelarse desde la cola de prioridades.

## Notas / Changelog
- 2026-05-22: nivel simple. Marcado `estado: wip`.
