// Edge Function: firma URLs de stream para el LAN server.
//
// El cliente (PWA) llama aquí con su JWT antes de pulsar play. La función:
//   1. Valida el JWT contra Supabase Auth (automático vía supabase-js).
//   2. SELECT del track aplicando RLS (auth.uid() = user_id).
//   3. Si el user es dueño del track, firma HMAC con `STREAM_SIGNING_SECRET`.
//   4. Devuelve la URL completa `/stream/<UUID>?sig=...&exp=...&yt=<ytId>`.
//
// El LAN server NO consulta Supabase — solo valida HMAC + exp. Esto:
//   - Centraliza la autorización en Supabase (RLS único punto de verdad).
//   - Elimina la service role del desktop.
//   - Permite que el secret rote sin afectar firmas ya emitidas (≤5 min).
//
// Endpoints:
//   POST /sign-stream  { trackId, lanBaseUrl, lanBearer? }
//                       → { url, expiresAt, ytId }
//
// Headers:
//   Authorization: Bearer <JWT del usuario>
//   apikey: <SUPABASE_ANON_KEY>

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SIGNING_SECRET = Deno.env.get('STREAM_SIGNING_SECRET');

// TTL de las URLs firmadas (segundos). 5 min: suficiente para que la
// sesión `<audio>` y los Range requests subsiguientes no caduquen, sin
// extender innecesariamente la ventana de exposure.
const STREAM_TTL_SEC = 5 * 60;

/**
 * Firma HMAC-SHA256 → base64url (URL-safe, sin padding).
 */
async function hmac(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return base64url(new Uint8Array(sig));
}

function base64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405, headers: CORS });
  }
  if (!SIGNING_SECRET) {
    return new Response(JSON.stringify({ error: 'STREAM_SIGNING_SECRET not configured' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return new Response(JSON.stringify({ error: 'missing JWT' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body: { trackId?: string; lanBaseUrl?: string; lanBearer?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  const { trackId, lanBaseUrl, lanBearer } = body;
  if (!trackId || !lanBaseUrl) {
    return new Response(JSON.stringify({ error: 'trackId and lanBaseUrl required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Cliente Supabase con el JWT del usuario → RLS aplica.
  // SELECT solo devuelve la fila si auth.uid() = tracks.user_id.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: track, error } = await supabase
    .from('tracks')
    .select('id, yt_id, source')
    .eq('id', trackId)
    .maybeSingle();

  if (error) {
    console.warn('[sign-stream] supabase error', error.message);
    return new Response(JSON.stringify({ error: 'lookup failed' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (!track) {
    // Bien por RLS (track de otro user) o no existe. Mismo response: 404.
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Firma HMAC. Payload incluye trackId, ytId, exp para que el LAN server
  // pueda resolver vía yt-dlp sin consultar nada externo. ytId va también
  // en la URL para que el LAN server lo lea directamente.
  const exp = Math.floor(Date.now() / 1000) + STREAM_TTL_SEC;
  const ytId = track.yt_id ?? '';
  const payload = `${trackId}|${ytId}|${exp}`;
  const sig = await hmac(SIGNING_SECRET, payload);

  // Construir URL final. El cliente la asigna a `<audio>.src`.
  const base = String(lanBaseUrl).replace(/\/$/, '');
  const params = new URLSearchParams();
  if (lanBearer) params.set('token', lanBearer);
  params.set('sig', sig);
  params.set('exp', String(exp));
  if (ytId) params.set('yt', ytId);
  const url = `${base}/stream/${encodeURIComponent(trackId)}?${params.toString()}`;

  return new Response(
    JSON.stringify({ url, expiresAt: exp, ytId }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
});
