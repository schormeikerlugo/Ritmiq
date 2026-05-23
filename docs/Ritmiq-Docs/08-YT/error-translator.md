---
tipo: modulo
capa: yt
plataforma: desktop
estado: estable
ultima-revision: 2026-05-22
archivo: packages/yt/src/error-translator.js
tags: [yt, errores, ux]
---

# `yt/error-translator.js`

> Traduce mensajes técnicos de error de yt-dlp a strings user-friendly en español. Función pura, sin side-effects.

## Ubicación
`packages/yt/src/error-translator.js:1` (83 líneas)

## Firma

```js
function translateYtdlpError(err: unknown): string
```

Recibe cualquier valor (Error, string, null) y devuelve siempre un string listo para mostrar al usuario.

## Patrones cubiertos

| Patrón en raw error | Mensaje devuelto |
|---|---|
| `Video unavailable` / `video has been removed` | "Esta canción ya no está disponible en YouTube. Podés intentar buscar otra versión." |
| `uploader has not made... available in your country` / `geo-block` | "YouTube no permite ver esta canción desde tu país. Probá con otra versión o con una VPN." |
| `This video is private` | "Esta canción está en un video privado de YouTube. No se puede descargar." |
| `Sign in to confirm your age` / `age-restricted` | "YouTube pide login para esta canción (restricción de edad). Asegurate de tener sesión iniciada en Firefox." |
| `Sign in to confirm you're not a bot` | "YouTube exige iniciar sesión para esta canción. Verificá que estés logueado en Firefox." |
| `copyright` / `DMCA` | "Esta canción fue removida de YouTube por reclamo de copyright." |
| `members-only` / `Premium video` | "Esta canción requiere membresía del canal o YouTube Premium." |
| `live stream recording is not available` | "Esta canción es un live stream que aún no tiene grabación descargable." |
| `HTTP Error 4xx/5xx` / `ECONNRESET` / `timed out` | "Hubo un problema de red al descargar. Probá de nuevo en un momento." |
| `Requested format is not available` | "YouTube no ofrece un formato de audio compatible para esta canción." |
| `ERROR: ...` (línea de error de yt-dlp) | "No se pudo procesar esta canción: <primeros 180 chars del ERROR>" |
| Fallback | "No se pudo procesar esta canción. Probá con otra o reintentá más tarde." |

## Anatomía del código (snippet clave)

### Extracción de la línea ERROR del stderr
`packages/yt/src/error-translator.js:72-79`

```js
const errLine = raw.match(/ERROR:[^\n]+/);
if (errLine) {
  const cleaned = errLine[0]
    .replace(/^ERROR:\s*/, '')
    .replace(/\[youtube\]\s*\w+:\s*/, '')
    .slice(0, 180);
  return `No se pudo procesar esta canción: ${cleaned}`;
}
```

**Por qué 180 chars**: lo suficiente para capturar el mensaje útil, sin mostrar el traceback completo de yt-dlp que contiene paths internos y versiones. La UI suele tener ~200px de ancho disponibles para mensajes de error.

**Por qué eliminar `[youtube] <id>:`**: yt-dlp prefixa los errores con el ID del video. Para el usuario ese ID es ruido; el mensaje de error es lo que importa.

## Casos de borde

- **`err` es null/undefined**: `String(undefined)` → `"undefined"`. Ningún patrón matchea → devuelve el fallback genérico. Correcto.
- **Error de SIGTERM/SIGKILL** (`yt-dlp killed (SIGTERM)`): ningún patrón matchea → fallback genérico. En la práctica, los kills son internos al [[lan-server]] y el caller absorbe el error antes de mostrarlo al usuario.
- **Error con múltiples líneas ERROR**: solo matchea la primera con `raw.match(/ERROR:[^\n]+/)`. El resto del stderr (deprecated warnings, client skips) queda descartado. Intencional.
- **Error que cambia en versiones futuras de yt-dlp**: si yt-dlp cambia el texto de un mensaje, el patrón no matchea → fallback. Nunca falla con error, solo se degrada a mensaje genérico. Revisar esta función cuando yt-dlp saque major release.

## Dependencias entrantes
- [[ipc]] → `translateYtdlpError(err)` en el catch de `library:download` y `yt:streamUrl`.
- [[lan-server]] → en endpoints de `/stream/` y `/download/`.

## Dependencias salientes
- Ninguna — función pura.

## Qué puede romper este cambio

| Cambio | Síntoma observable |
|---|---|
| Quitar el fallback final | Si ningún patrón matchea, la función devuelve `undefined` → la UI muestra "undefined" o crashea. |
| Slice a < 50 chars | Mensajes útiles se truncan demasiado → usuario no puede diagnosticar el problema. |
| Cambiar patrones a case-sensitive | yt-dlp cambia capitalización entre versiones → mensajes dejan de traducirse. |

## Notas / Changelog
- 2026-05-22: nivel simple.
