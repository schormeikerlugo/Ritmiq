/**
 * Traduce mensajes de error de yt-dlp a mensajes user-friendly.
 *
 * yt-dlp emite errores tecnicos con mucho ruido (deprecated warnings,
 * lista de clientes saltados, listas de paises, etc.). Para la UI
 * preferimos un mensaje corto y accionable.
 *
 * Si el error no matchea ningun patron conocido, se devuelve uno
 * generico con la primera linea ERROR del stderr (truncada).
 *
 * @module @ritmiq/yt/error-translator
 */

/**
 * @param {unknown} err
 * @returns {string} Mensaje en espanol, listo para mostrar al usuario.
 */
export function translateYtdlpError(err) {
  const raw = String(err?.message ?? err ?? '');

  // Video borrado o nunca existio.
  if (/Video unavailable|This video is not available|video has been removed/i.test(raw)) {
    return 'Esta canción ya no está disponible en YouTube. Podés intentar buscar otra versión.';
  }

  // Geo-bloqueo regional.
  if (/uploader has not made this video available in your country|geographic|geo[- ]?block/i.test(raw)) {
    return 'YouTube no permite ver esta canción desde tu país. Probá con otra versión o con una VPN.';
  }

  // Video privado.
  if (/This video is private|Private video/i.test(raw)) {
    return 'Esta canción está en un video privado de YouTube. No se puede descargar.';
  }

  // Edad restringida sin cookies validas.
  if (/Sign in to confirm your age|age[- ]?restricted/i.test(raw)) {
    return 'YouTube pide login para esta canción (restricción de edad). Asegurate de tener sesión iniciada en Firefox.';
  }

  // Login requerido.
  if (/Sign in to confirm you.re not a bot|sign in to view/i.test(raw)) {
    return 'YouTube exige iniciar sesión para esta canción. Verificá que estés logueado en Firefox.';
  }

  // Copyright / DMCA.
  if (/copyright|DMCA/i.test(raw)) {
    return 'Esta canción fue removida de YouTube por reclamo de copyright.';
  }

  // Membership / premium only.
  if (/members[- ]?only|Premium video/i.test(raw)) {
    return 'Esta canción requiere membresía del canal o YouTube Premium.';
  }

  // Live streams (no descargables).
  if (/This live stream recording is not available|live event will begin/i.test(raw)) {
    return 'Esta canción es un live stream que aún no tiene grabación descargable.';
  }

  // Network / timeout transitorio.
  if (/Unable to download|HTTP Error 4\d\d|HTTP Error 5\d\d|ECONNRESET|timed? ?out/i.test(raw)) {
    return 'Hubo un problema de red al descargar. Probá de nuevo en un momento.';
  }

  // Format selector fallo (no hay m4a/audio compatible).
  if (/Requested format is not available|No video formats found/i.test(raw)) {
    return 'YouTube no ofrece un formato de audio compatible para esta canción.';
  }

  // yt-dlp exited <N>: ... — fallback: extraer primera linea ERROR del stderr.
  const errLine = raw.match(/ERROR:[^\n]+/);
  if (errLine) {
    const cleaned = errLine[0]
      .replace(/^ERROR:\s*/, '')
      .replace(/\[youtube\]\s*\w+:\s*/, '')
      .slice(0, 180);
    return `No se pudo procesar esta canción: ${cleaned}`;
  }

  // Ultimo fallback: mensaje generico sin detalles tecnicos.
  return 'No se pudo procesar esta canción. Probá con otra o reintentá más tarde.';
}
