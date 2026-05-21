/**
 * Vercel Serverless Function — POST /api/mark-installed
 *
 * Propósito: establecer una cookie de primer origen que sea visible tanto
 * desde Safari iOS como desde la PWA standalone. En iOS, localStorage está
 * SEGREGADO entre Safari y la PWA (no se comparte), pero las cookies del
 * mismo origen SÍ se comparten. Esto permite que la SharedView en Safari
 * detecte si el dispositivo ya tiene la PWA instalada y muestre el banner
 * "Abrir en Ritmiq" en vez del de instalación.
 *
 * La cookie NO es HttpOnly a propósito — necesitamos leerla desde JS del
 * cliente (Safari, fuera del contexto de la PWA standalone).
 *
 * Seguridad: no expone datos sensibles. El valor es constante ("1").
 * No requiere autenticación — cualquier visitante puede marcarla, lo cual
 * es el comportamiento deseado: solo la PWA standalone llamará este endpoint.
 */

export default function handler(req, res) {
  // Solo aceptar POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // CORS — permitir el origen de la PWA en producción y localhost en dev.
  // La cookie se setea sobre el mismo origen (ritmiq.app), así que CORS
  // aquí es por seguridad adicional del endpoint, no para el cookie sharing.
  const origin = req.headers.origin ?? '';
  const allowedOrigins = [
    'https://ritmiq.app',
    'https://www.ritmiq.app',
    'http://localhost:5173',
    'http://localhost:4173',
  ];
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');

  // Cookie de primer origen: 1 año, Lax (permite navegación top-level),
  // Secure (solo HTTPS), NO HttpOnly (JS del cliente la necesita leer).
  res.setHeader(
    'Set-Cookie',
    'ritmiq_installed=1; Path=/; Max-Age=31536000; Secure; SameSite=Lax',
  );

  return res.status(200).json({ ok: true });
}
