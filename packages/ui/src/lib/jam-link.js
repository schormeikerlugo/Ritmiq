/**
 * Enlace público para unirse a una jam (`https://ritmiq.app/jam/<CODE>`).
 *
 * En la PWA se usa el propio origen; en la app de TV (`http://localhost`) y
 * en el escritorio (Electron) el origen no es público, así que se usa el
 * dominio de la PWA. Es lo que codifica el QR de la TV.
 *
 * @module @ritmiq/ui/lib/jam-link
 */
const PUBLIC_ORIGIN = 'https://ritmiq.app';

/** @param {string} code */
export function buildJamLink(code) {
  let origin = PUBLIC_ORIGIN;
  try {
    const o = window.location.origin;
    if (/^https:\/\//.test(o) && !/localhost|127\.0\.0\.1/.test(o)) origin = o;
  } catch { /* sin window */ }
  return `${origin}/jam/${code}`;
}
