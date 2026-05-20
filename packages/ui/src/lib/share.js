/**
 * Compartir tracks por link publico.
 *
 * Formato (path-based, mas limpio para humanos y mejor SEO):
 *   https://ritmiq.app/share/track/<ytId>?meta=<base64url-payload>
 *
 * El payload base64url contiene un JSON minimo con title/artist/cover —
 * permite que la landing publica muestre la metadata SIN llamar al server.
 * Si el payload esta corrupto/ausente, la landing cae a "Reproducir en
 * YouTube" usando el ytId.
 *
 * Backwards-compat: tambien parsea el formato anterior ?share=track:...
 * para que links viejos sigan funcionando.
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
  return `${origin}/share/track/${encodeURIComponent(track.ytId)}?meta=${encoded}`;
}

/**
 * Parsea la URL actual buscando un share. Soporta dos formatos:
 *   - Nuevo (path-based):   /share/track/<ytId>?meta=<b64>
 *   - Legacy (query-based): /?share=track:<ytId>:<b64>
 *
 * Devuelve null si ninguno coincide.
 *
 * @returns {{ type:'track', ytId:string, title:string|null, artist:string|null, coverUrl:string|null } | null}
 */
export function parseShareFromUrl() {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname || '';
  const params = new URLSearchParams(window.location.search);

  // Formato nuevo: /share/track/<ytId>?meta=<payload>
  const pathMatch = path.match(/^\/share\/track\/([^/]+)\/?$/);
  if (pathMatch) {
    const ytId = decodeURIComponent(pathMatch[1]);
    const encoded = params.get('meta');
    let meta = { t: null, a: null, c: null };
    if (encoded) {
      try { meta = JSON.parse(b64urlDecode(encoded)); } catch {}
    }
    return {
      type: 'track',
      ytId,
      title: meta?.t ?? null,
      artist: meta?.a ?? null,
      coverUrl: meta?.c ?? null,
    };
  }

  // Formato legacy: ?share=track:<ytId>:<payload>
  const raw = params.get('share');
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length < 2) return null;
  const [kind, ytIdRaw, encoded] = parts;
  if (kind !== 'track' || !ytIdRaw) return null;
  let meta = { t: null, a: null, c: null };
  if (encoded) {
    try { meta = JSON.parse(b64urlDecode(encoded)); } catch {}
  }
  return {
    type: 'track',
    ytId: decodeURIComponent(ytIdRaw),
    title: meta?.t ?? null,
    artist: meta?.a ?? null,
    coverUrl: meta?.c ?? null,
  };
}

/**
 * Limpia el share de la URL del navegador sin recargar la pagina.
 * Funciona tanto para el formato path-based como para el query legacy.
 */
export function clearShareFromUrl() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    // Si estamos en /share/track/..., volvemos a /
    if (/^\/share\/track\//.test(url.pathname)) {
      url.pathname = '/';
    }
    url.searchParams.delete('share');
    url.searchParams.delete('meta');
    window.history.replaceState({}, '', url.toString());
  } catch {}
}

/**
 * Detecta si la app se esta ejecutando como PWA standalone (instalada
 * en home screen, no en pestaña del navegador).
 */
export function isStandalonePWA() {
  if (typeof window === 'undefined') return false;
  // Chrome / Android / desktop PWA.
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari standalone (legacy flag — sigue siendo el unico
  // mecanismo fiable en iOS).
  if (window.navigator?.standalone === true) return true;
  return false;
}

/**
 * Marca este device como "tiene Ritmiq PWA instalada" en localStorage.
 * Se llama al arrancar la app en modo standalone. Sirve para que las
 * pestanas del navegador del mismo origen muestren el banner "Abrir en
 * Ritmiq" cuando sea apropiado.
 *
 * Limitacion conocida iOS: Safari y la PWA standalone tienen storage
 * SEGREGADO en iOS, asi que este flag solo lo leera la propia PWA. La
 * deteccion cross-context en Safari iOS requiere endpoint server con
 * cookie (T4 — diferido). Aun asi, el flag sirve para que la PWA
 * standalone NO muestre banners de "instalar" innecesarios.
 */
const INSTALLED_FLAG = 'ritmiq.pwa-installed';
export function markPwaInstalled() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(INSTALLED_FLAG, '1'); } catch {}
}
export function hasPwaInstalledFlag() {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(INSTALLED_FLAG) === '1'; } catch { return false; }
}

/**
 * Detecta la plataforma para mostrar instrucciones especificas en la
 * landing publica. Solo distinguimos iOS / Android / Desktop — suficiente
 * para tomar decisiones de UX.
 */
export function detectPlatform() {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  // iOS: iPhone, iPad, iPod, o iPadOS 13+ que reporta como Mac con touch.
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && 'ontouchend' in document);
  if (isIOS) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
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
