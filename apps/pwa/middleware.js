/**
 * Vercel Edge Middleware — inyeccion de Open Graph / Twitter Card.
 *
 * Por que existe (T7):
 *   Cuando alguien pega `https://ritmiq.app/share/track/<ytId>?meta=<b64>`
 *   en WhatsApp / Twitter / iMessage / Facebook, los scrapers de esos
 *   servicios hacen un GET al URL y leen los <meta> del HTML. NO ejecutan
 *   JavaScript, asi que cualquier OG tag que React inyecte en runtime es
 *   invisible para ellos. Para conseguir previews ricas (cover + titulo +
 *   artista) la unica via es server-side: interceptar el request antes de
 *   servir el index.html y reemplazar los meta tags.
 *
 * Estrategia:
 *   1. Solo activamos el middleware en `/share/track/:ytId` (matcher).
 *   2. Leemos `?meta=<base64url(JSON)>` con title/artist/cover.
 *   3. Si el payload es invalido o falta, dejamos pasar al SPA sin tocar
 *      nada (la SPA muestra fallback "abrir en YouTube").
 *   4. Si es valido, hacemos fetch al index.html del propio deploy
 *      (siempre disponible en `/`), reemplazamos el <title>, y inyectamos
 *      OG + Twitter Card tags antes de </head>.
 *   5. Devolvemos el HTML modificado con cache-control corto (5 min) —
 *      los meta del share son por-URL pero los scrapers suelen cachear.
 *
 * Por que NO redirigimos a un endpoint dedicado:
 *   - Mantener una sola URL canonica para humanos y bots.
 *   - El SPA en cliente sigue funcionando: cuando React monta, ignora
 *     los OG tags y renderiza la SharedView normal con el `?meta=`.
 *
 * @see packages/ui/src/lib/share.js — buildShareLink, parseShareFromUrl
 * @see docs/share-deeplink-roadmap.md — T7
 */

export const config = {
  // Solo interceptamos shares de tracks. El resto del trafico pasa por
  // edge sin ningun overhead.
  matcher: '/share/track/:ytId*',
};

/** base64url-decode a UTF-8 string. Espejo de share.js. */
function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
  const padded = b64 + '='.repeat(pad);
  // atob esta disponible en Edge Runtime.
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Escape HTML para evitar inyeccion via meta del share. */
function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Construye el bloque de <meta> a inyectar. Cubre Open Graph (Facebook /
 * WhatsApp / iMessage) y Twitter Card (Twitter / X).
 */
function buildMetaTags({ title, artist, cover, url }) {
  const fullTitle = artist ? `${title} — ${artist}` : title;
  const description = artist
    ? `Escucha "${title}" de ${artist} en Ritmiq.`
    : `Escucha "${title}" en Ritmiq.`;
  const image = cover || 'https://ritmiq.app/icon-512.png';

  return [
    `<meta property="og:type" content="music.song" />`,
    `<meta property="og:site_name" content="Ritmiq" />`,
    `<meta property="og:title" content="${escapeHtml(fullTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    artist ? `<meta property="music:musician" content="${escapeHtml(artist)}" />` : '',
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(fullTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
  ].filter(Boolean).join('\n    ');
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/share\/track\/([^/]+)\/?$/);

  // Si por alguna razon el matcher dejo pasar algo que no es share, sigue.
  if (!match) return fetch(request);

  const encoded = url.searchParams.get('meta');
  if (!encoded) {
    // Sin meta no podemos enriquecer. Dejamos pasar al SPA tal cual.
    return fetch(request);
  }

  let meta;
  try {
    meta = JSON.parse(b64urlDecode(encoded));
  } catch {
    // Payload corrupto: dejamos pasar al SPA.
    return fetch(request);
  }

  const title = typeof meta?.t === 'string' && meta.t.trim() ? meta.t.trim() : null;
  const artist = typeof meta?.a === 'string' && meta.a.trim() ? meta.a.trim() : null;
  const cover = typeof meta?.c === 'string' && meta.c.trim() ? meta.c.trim() : null;

  if (!title) {
    // Sin title no hay preview que valga la pena. SPA fallback.
    return fetch(request);
  }

  // Fetch al index.html del propio origen. Vercel sirve el SPA desde /
  // y devuelve siempre el mismo HTML para rutas SPA.
  const originHtmlUrl = new URL('/', url.origin);
  let html;
  try {
    const res = await fetch(originHtmlUrl, {
      // Heredamos el accept del client para que Vercel sirva el HTML real.
      headers: { 'accept': 'text/html' },
    });
    if (!res.ok) return fetch(request);
    html = await res.text();
  } catch {
    return fetch(request);
  }

  const metaTags = buildMetaTags({
    title,
    artist,
    cover,
    url: url.toString(),
  });

  const fullTitle = artist ? `${title} — ${artist} | Ritmiq` : `${title} | Ritmiq`;

  // Reemplazo de <title>Ritmiq</title> por el contextual. Tolerante a
  // espacios y a que el <title> ya tenga algo distinto en futuras builds.
  let transformed = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapeHtml(fullTitle)}</title>`,
  );

  // Inyectamos los meta justo antes de </head>. Si no hay </head> (caso
  // raro), append al final \u2014 los scrapers leen igual.
  if (transformed.includes('</head>')) {
    transformed = transformed.replace(
      '</head>',
      `    ${metaTags}\n  </head>`,
    );
  } else {
    transformed += `\n${metaTags}\n`;
  }

  return new Response(transformed, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Scrapers cachean por URL; 5 min es buen balance entre frescura
      // y reduccion de invocaciones.
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  });
}
