// Edge Function: get-stream-url
//
// Lookup en `stream_url_cache` para clientes que no tienen LAN propio.
// Si HIT: devuelve URL + content_type + expiresAt. Si MISS: 404.
//
// Auth: cualquier user autenticado puede leer (cache global anonimo).
//
// Cache HTTP edge: max-age=60. Permite que Cloudflare/Supabase Edge
// cachee front respuestas para tracks populares.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'missing token' }, 401);

  const url = new URL(req.url);
  const ytId = url.searchParams.get('ytId');
  if (!ytId) return json({ error: 'ytId required' }, 400);

  // Cliente con anon key + JWT del user para que RLS valide.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // SELECT con filtro de TTL margen 30s.
  const cutoff = new Date(Date.now() + 30_000).toISOString();
  const { data, error } = await userClient
    .from('stream_url_cache')
    .select('yt_id, url, content_type, expires_at, source')
    .eq('yt_id', ytId)
    .gt('expires_at', cutoff)
    .maybeSingle();

  if (error) {
    console.error('[get-stream-url] select error:', error.message);
    return json({ error: 'select failed' }, 502);
  }

  if (!data) {
    return json({ url: null }, 404, {
      'Cache-Control': 'no-store',
    });
  }

  return json({
    url: data.url,
    contentType: data.content_type,
    expiresAt: data.expires_at,
    source: data.source,
  }, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});
