// Edge Function: búsqueda en YouTube Data API v3.
// Recibe { query } y devuelve resultados normalizados.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const API = 'https://www.googleapis.com/youtube/v3/search';

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const apiKey = Deno.env.get('YOUTUBE_API_KEY');
  if (!apiKey) {
    return json({ error: 'YOUTUBE_API_KEY not configured' }, 500);
  }

  const { query, max = 10 } = await req.json().catch(() => ({}));
  if (!query) return json({ error: 'query required' }, 400);

  const url = new URL(API);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', String(max));
  url.searchParams.set('q', query);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    return json({ error: 'youtube api error', status: res.status }, 502);
  }
  const data = await res.json();
  const items = (data.items ?? []).map((it) => ({
    ytId: it.id.videoId,
    title: it.snippet.title,
    channel: it.snippet.channelTitle,
    thumbnail: it.snippet.thumbnails?.medium?.url ?? null,
  }));
  return json({ items });
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
