// Edge Function: Spotify OAuth PKCE callback handler.
//
// Flow:
//   1. Cliente abre window a https://accounts.spotify.com/authorize con
//      client_id, redirect_uri, code_challenge, scope.
//   2. Usuario autoriza en Spotify; redirect a:
//        https://<ritmiq>/api/spotify/callback?code=<code>&state=<state>
//   3. Esa ruta (Vercel function o middleware) hace POST a este endpoint
//      con { code, codeVerifier, userId } como body.
//   4. Esta function intercambia el code por access_token + refresh_token,
//      persiste en spotify_tokens, devuelve { ok: true }.
//
// Alternativa: el callback puede llamarse directo desde el cliente cuando
// el codeVerifier vive en sessionStorage. Mas simple pero expone el
// client_id (aceptable para PKCE) y el flow al user.
//
// Endpoints:
//   POST /spotify-callback
//   Headers: Authorization: Bearer <user JWT>
//   Body: { code: string, codeVerifier: string, redirectUri: string }
//
// Respuesta:
//   { ok: true, expiresIn: 3600 }
//
// Variables de entorno requeridas (Supabase secrets):
//   SPOTIFY_CLIENT_ID  \u2014 obligatorio
//   SPOTIFY_CLIENT_SECRET \u2014 opcional (PKCE no lo necesita; si esta, mejor)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Identificar al usuario via JWT.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const clientId = Deno.env.get('SPOTIFY_CLIENT_ID');
  const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET'); // opcional con PKCE

  if (!clientId) {
    return json({ error: 'SPOTIFY_CLIENT_ID no configurado en el server' }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'no autenticado' }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const code = String(body?.code ?? '').trim();
  const codeVerifier = String(body?.codeVerifier ?? '').trim();
  const redirectUri = String(body?.redirectUri ?? '').trim();

  if (!code || !codeVerifier || !redirectUri) {
    return json({ error: 'code, codeVerifier, redirectUri requeridos' }, 400);
  }

  // Intercambiar code por tokens.
  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('redirect_uri', redirectUri);
  params.set('client_id', clientId);
  params.set('code_verifier', codeVerifier);
  // Si hay secret, lo enviamos en Authorization basic; mejor seguridad.
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (clientSecret) {
    const basic = btoa(`${clientId}:${clientSecret}`);
    headers['Authorization'] = `Basic ${basic}`;
  }

  let tokenRes;
  try {
    tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers,
      body: params.toString(),
    });
  } catch (e) {
    return json({ error: `network: ${String((e as Error)?.message ?? e)}` }, 502);
  }

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text().catch(() => '');
    return json({ error: `spotify ${tokenRes.status}: ${errBody.slice(0, 200)}` }, 502);
  }

  const tokenData = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  const expiresAt = new Date(Date.now() + (tokenData.expires_in - 30) * 1000);
  // -30s de margen para evitar usar el token justo cuando vence.

  // Persistir via service role.
  const admin = createClient(supabaseUrl, serviceKey);
  try {
    await admin.from('spotify_tokens').upsert({
      user_id: user.id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt.toISOString(),
      scope: tokenData.scope,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  } catch (e) {
    return json({ error: `cache write: ${String((e as Error)?.message ?? e)}` }, 500);
  }

  return json({ ok: true, expiresIn: tokenData.expires_in });
});
