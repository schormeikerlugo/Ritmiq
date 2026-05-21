/**
 * Vercel Edge Middleware — OG tags para /share/track/:ytId
 *
 * Propósito: cuando alguien pega un link de share en WhatsApp, iMessage,
 * Twitter, etc., el scraper NO ejecuta JS. Al servir el index.html del SPA
 * tal cual, el scraper ve solo los OG tags genéricos del index.html.
 *
 * Este middleware intercepta rutas /share/track/* ANTES de que Vercel
 * sirva el index.html, decodifica el ?meta=<base64url> payload, y
 * reescribe el <head> del HTML para inyectar OG tags personalizados
 * (título, artista, cover del track).
 *
 * Solo modifica la respuesta si el User-Agent del request parece ser un
 * bot/scraper (no un navegador real). Los navegadores reales reciben el
 * SPA normal y React hidrata la UI.
 *
 * @see https://vercel.com/docs/functions/edge-middleware
 */

export const config = {
  matcher: ['/share/track/:ytId*'],
};

/** Decodifica base64url → string. Mismo algoritmo que lib/share.js. */
function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
  const padded = b64 + '='.repeat(pad);
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

/** Devuelve true si el User-Agent es un bot/scraper, no un navegador real. */
function isCrawler(ua) {
  if (!ua) return false;
  return /facebookexternalhit|twitterbot|whatsapp|telegrambot|slackbot|linkedinbot|discordbot|applebot|googlebot|bingbot|yandexbot|duckduckbot|pinterest|vkshare|w3c_validator|iframely/i.test(ua);
}

export default async function middleware(request) {
  const url = new URL(request.url);

  // Solo inyectamos OG tags para crawlers/scrapers. Los navegadores reales
  // reciben el SPA normal — React renderiza la UI y gestiona el share.
  const ua = request.headers.get('user-agent') ?? '';
  if (!isCrawler(ua)) {
    // Pasar al siguiente handler (Vercel sirve index.html normalmente).
    return;
  }

  // Extraer ytId del path /share/track/<ytId>
  const match = url.pathname.match(/^\/share\/track\/([^/]+)/);
  if (!match) return NextResponse.next();
  const ytId = decodeURIComponent(match[1]);

  // Decodificar el ?meta=<base64url> payload
  let title = null;
  let artist = null;
  let coverUrl = null;

  const metaParam = url.searchParams.get('meta');
  if (metaParam) {
    try {
      const decoded = b64urlDecode(metaParam);
      if (decoded) {
        const parsed = JSON.parse(decoded);
        title = parsed.title ?? null;
        artist = parsed.artist ?? null;
        coverUrl = parsed.coverUrl ?? null;
      }
    } catch {
      // meta corrupto — continúa con fallbacks
    }
  }

  // Fallbacks
  const ogTitle = title
    ? `${title}${artist ? ` · ${artist}` : ''} — Ritmiq`
    : 'Ritmiq — Escucha música';
  const ogDescription = title
    ? `Escucha "${title}"${artist ? ` de ${artist}` : ''} en Ritmiq`
    : 'Tu reproductor de música personal. Descúbrelo en ritmiq.app';
  // Fallback: icon-512.png ya existe en el deploy (apps/pwa/public/).
  const ogImage = coverUrl ?? 'https://ritmiq.app/icon-512.png';
  const ogUrl = url.href;
  const canonicalYtUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(ytId)}`;

  // Fetch del index.html que Vercel serviría normalmente
  const indexUrl = new URL('/', url.origin);
  const indexRes = await fetch(indexUrl.toString());
  const html = await indexRes.text();

  // Inyectar OG tags en el <head>, justo después de <head>
  const ogTags = `
  <!-- OG tags inyectados por Edge Middleware para share preview -->
  <meta property="og:type" content="music.song" />
  <meta property="og:site_name" content="Ritmiq" />
  <meta property="og:title" content="${escapeAttr(ogTitle)}" />
  <meta property="og:description" content="${escapeAttr(ogDescription)}" />
  <meta property="og:image" content="${escapeAttr(ogImage)}" />
  <meta property="og:url" content="${escapeAttr(ogUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeAttr(ogTitle)}" />
  <meta name="twitter:description" content="${escapeAttr(ogDescription)}" />
  <meta name="twitter:image" content="${escapeAttr(ogImage)}" />
  <link rel="canonical" href="${escapeAttr(canonicalYtUrl)}" />`;

  const patched = html.replace('<head>', `<head>${ogTags}`);

  return new Response(patched, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // No cachear — la URL puede cambiar de metadata
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
  });
}

/** Escapa comillas para inyección segura en atributos HTML. */
function escapeAttr(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
