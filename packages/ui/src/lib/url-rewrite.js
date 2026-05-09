/**
 * Reescribe URLs que apuntan a 127.0.0.1/localhost al hostname actual.
 *
 * Caso de uso: la PWA carga desde una IP de LAN (192.168.x.x) pero las
 * URLs guardadas en Supabase Storage local quedan registradas con
 * `127.0.0.1`, que en el móvil apunta al propio dispositivo. Al renderizar
 * imágenes/audio fallan. Esta función las reescribe para que apunten al
 * mismo host desde el que se sirvió la app.
 *
 * @param {string|null|undefined} url
 * @returns {string|null|undefined}
 */
export function rewriteHost(url) {
  if (!url || typeof window === 'undefined') return url;
  try {
    const u = new URL(url);
    const isLoopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    if (!isLoopback) return url;

    const pageHost = window.location.hostname;
    const pageIsLoopback = pageHost === '127.0.0.1' || pageHost === 'localhost';
    if (pageIsLoopback) return url; // tampoco hace falta tocar nada

    u.hostname = pageHost;
    return u.toString();
  } catch {
    return url;
  }
}
