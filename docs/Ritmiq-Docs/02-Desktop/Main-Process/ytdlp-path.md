---
tipo: modulo
capa: desktop-main
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: apps/desktop/main/ytdlp-path.js
tags: [desktop, yt-dlp, binarios]
---

# `main/ytdlp-path.js`

> Resuelve la ruta al binario `yt-dlp` según contexto (actualización del usuario, packaged, dev, PATH).

## Ubicación
`apps/desktop/main/ytdlp-path.js:1` (44 líneas)

## Exports

### `getYtDlpUserDataPath(): string`

Devuelve `<userData>/bin/yt-dlp` (crea el directorio si no existe). Es el path donde [[ipc]] (`ytdlp:update`) descarga la última versión.

### `getYtDlpPath(): string`

Resuelve cuál binario usar **en este orden**:

| Prioridad | Path | Cuándo aplica |
|---|---|---|
| 1 | `<userData>/bin/yt-dlp` | Usuario lo actualizó desde Settings |
| 2 | `<resourcesPath>/bin/yt-dlp` | App empaquetada (`electron-builder` lo bundlea) |
| 3 | `apps/desktop/bin/yt-dlp` | Desarrollo (`pnpm dev:desktop`) |
| 4 | `'yt-dlp'` | Fallback a `$PATH` |

## Anatomía del código (snippet completo)

`apps/desktop/main/ytdlp-path.js:27-43`

```js
export function getYtDlpPath() {
  // 1. Versión actualizada por el usuario.
  const userPath = getYtDlpUserDataPath();
  if (existsSync(userPath)) return userPath;

  // 2. Versión empaquetada (release).
  if (app.isPackaged) {
    const packed = join(process.resourcesPath, 'bin', 'yt-dlp');
    if (existsSync(packed)) return packed;
  }

  // 3. Desarrollo.
  const dev = join(__dirname, '..', 'bin', 'yt-dlp');
  if (existsSync(dev)) return dev;

  // 4. Fallback PATH.
  return 'yt-dlp';
}
```

**Por qué la versión del usuario gana**: YouTube cambia su API cada pocas semanas. yt-dlp libera fixes en días, pero releases de Ritmiq tardan más. Permitir al usuario actualizar el binario sin esperar release de la app evita downtime.

**Por qué retornar `'yt-dlp'` literal como fallback**: si el usuario tiene yt-dlp instalado globalmente (`pacman`, `brew`), `spawn` lo resuelve por PATH y funciona sin que la app traiga binario propio. Útil para Linux distros con yt-dlp en repos.

## Dependencias entrantes
- [[ipc]] → `getYtDlpPath()` (para `ytdlp:info`, `ytdlp:update`, ytOpts) y `getYtDlpUserDataPath()` (target del download).
- [[lan-server]] → `getYtDlpPath()` para spawn yt-dlp.

## Dependencias salientes
- `electron.app` (`isPackaged`, `process.resourcesPath`).
- `node:fs` (`existsSync`, `mkdirSync`).

## Side-effects
- Crea `<userData>/bin/` si no existe.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Cambiar el orden de prioridad | Versión del usuario deja de ganar → usuarios no pueden parchear yt-dlp sin update de Ritmiq. |
| Eliminar el fallback PATH | Distros Linux que confían en yt-dlp del sistema dejan de funcionar sin error claro. |
| Cambiar nombre del binario sin actualizar `electron-builder` config | En empaquetado, paso 2 falla; cae a PATH; si no está en PATH, spawn falla. |

## Notas

- Actualización en runtime: la UI llama `ritmiq.ytdlp.update()` → [[ipc]] descarga desde GitHub a `userData/bin/yt-dlp` con `chmod 0755` (Unix). Siguiente `spawn` usa la nueva versión.
- El binario bundleado se actualiza al hacer release; el del usuario sobrescribe.

## Notas / Changelog
- 2026-05-22: nivel simple.
