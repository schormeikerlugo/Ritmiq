/**
 * Compartir tracks por link publico.
 *
 * Formato del query param:
 *   ?share=track:<ytId>:<base64url-payload>
 *
 * El payload base64url contiene un JSON minimo con title/artist/cover —
 * permite que la landing publica muestre la metadata SIN llamar al server.
 * Si el payload esta corrupto/ausente, la landing cae a "Reproducir en
 * YouTube" usando el ytId.
 *
 * Solo tracks por ahora — playlists requieren migracion de DB (campo
 * is_public) que va en Fase 3.
 *
 * @module @ritmiq/ui/lib/share
 */

/** base64url-encode de un string UTF-8. */
function b64urlEncode(s) {
  // btoa solo acepta ASCII; codificamos via UTF-8 → bytes → base64
  const utf8 = new TextEncoder().encode(s);
  let bin = '';
  for (const b of utf8) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
  const padded = b64 + '='.repeat(pad);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Construye el link publico para un track. Devuelve una URL completa
 * basada en `window.location.origin` (PWA) o un placeholder si estamos
 * en Electron (donde la app no es web-accesible).
 *
 * @param {{ ytId?:string, title?:string, artist?:string, coverUrl?:string }} track
 * @returns {string}
 */
export function buildShareLink(track) {
  if (!track?.ytId) {
    // Fallback: track no tiene ytId → no es compartible como YouTube.
    return '';
  }
  const payload = {
    t: track.title ?? null,
    a: track.artist ?? null,
    c: track.coverUrl ?? null,
  };
  const encoded = b64urlEncode(JSON.stringify(payload));
  // origin: si estamos en Electron `file://`, intentar configurable
  // pero como MVP devolvemos un placeholder "https://ritmiq.app".
  let origin = 'https://ritmiq.app';
  if (typeof window !== 'undefined' && window.location?.origin) {
    const o = window.location.origin;
    if (o.startsWith('http')) origin = o;
  }
  return `${origin}/?share=track:${encodeURIComponent(track.ytId)}:${encoded}`;
}

/**
 * Parsea el query param `?share=...`. Devuelve null si no hay share.
 *
 * @returns {{ type:'track', ytId:string, title:string|null, artist:string|null, coverUrl:string|null } | null}
 */
export function parseShareFromUrl() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('share');
  if (!raw) return null;

  const parts = raw.split(':');
  if (parts.length < 2) return null;
  const [kind, ytId, encoded] = parts;
  if (kind !== 'track') return null;
  if (!ytId) return null;

  let meta = { t: null, a: null, c: null };
  if (encoded) {
    try {
      meta = JSON.parse(b64urlDecode(encoded));
    } catch {}
  }
  return {
    type: 'track',
    ytId: decodeURIComponent(ytId),
    title: meta?.t ?? null,
    artist: meta?.a ?? null,
    coverUrl: meta?.c ?? null,
  };
}

/**
 * Copia un texto al portapapeles. Usa Clipboard API si disponible, con
 * fallback a textarea + execCommand.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
