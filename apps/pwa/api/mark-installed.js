/**
 * POST /api/mark-installed
 *
 * Setea una cookie de primer origen `ritmiq_installed=1` que indica que
 * este device ya tiene la PWA de Ritmiq instalada como standalone.
 *
 * Motivacion (iOS):
 *   En iOS, Safari y la PWA standalone tienen storage SEGREGADO — no
 *   comparten localStorage ni IndexedDB. Las cookies del MISMO ORIGEN
 *   SI se comparten entre ambos contextos. Por eso usamos cookies para
 *   propagar el flag "PWA instalada" desde la PWA hacia Safari.
 *
 * Flujo:
 *   1. La PWA arranca en modo standalone (display-mode: standalone o
 *      navigator.standalone === true).
 *   2. App.jsx llama fire-and-forget a este endpoint.
 *   3. El endpoint setea la cookie con Max-Age de 1 ano.
 *   4. Cuando el usuario abre un link de Ritmiq en Safari iOS, la
 *      landing publica (SharedView) lee la cookie via hasPwaInstalledCookie()
 *      y muestra el banner correcto ("Abrir en Ritmiq" en vez de
 *      "Instala Ritmiq").
 *
 * Seguridad:
 *   - NO usamos HttpOnly: el cliente debe poder leerla con
 *     document.cookie para mostrar el banner correcto.
 *   - SameSite=Lax permite que la cookie se envie en navegaciones
 *     cross-context del mismo origen (link de WhatsApp -> Safari).
 *   - Secure: solo HTTPS en produccion. En dev local (localhost) los
 *     browsers permiten Set-Cookie sin Secure aunque este declarado.
 *   - No leemos ni escribimos nada mas: este endpoint es write-only,
 *     stateless, sin DB.
 *
 * Runtime: Edge para baja latencia (fire-and-forget desde la PWA al boot).
 *
 * @see packages/ui/src/lib/share.js — hasPwaInstalledCookie()
 * @see packages/ui/src/App.jsx — fetch a este endpoint en boot standalone
 * @see docs/share-deeplink-roadmap.md — T4
 */

export const config = {
  runtime: 'edge',
};

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const COOKIE_NAME = 'ritmiq_installed';

export default function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json', 'allow': 'POST' },
    });
  }

  // Cookie de primer origen, legible por JS, larga vida.
  // Path=/ para que sea accesible desde cualquier ruta de Ritmiq.
  const cookie = [
    `${COOKIE_NAME}=1`,
    'Path=/',
    `Max-Age=${ONE_YEAR_SECONDS}`,
    'Secure',
    'SameSite=Lax',
  ].join('; ');

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': cookie,
      'cache-control': 'no-store',
    },
  });
}
