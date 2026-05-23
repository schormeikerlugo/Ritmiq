// Edge Function: publish-stream-url
//
// Recibe del desktop una URL googlevideo recien resuelta por yt-dlp y la
// upserta en `stream_url_cache` para que otros clientes la usen sin
// volver a resolver. Fire-and-forget desde el caller (no bloquea).
//
// Auth: Bearer JWT del usuario propietario del desktop. Verificamos solo
// que sea un JWT valido (cualquier user autenticado puede contribuir al
// cache global).
//
// Rate-limit suave en memoria del isolate: max 200 upserts/min por user.
// Si reinicia el isolate se resetea — aceptable para uso normal.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Rate-limit in-memory: userId -> [timestamps].
const rateLimit = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 200;

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const arr = (rateLimit.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    rateLimit.set(userId, arr);
    return true;
  }
  arr.push(now);
  rateLimit.set(userId, arr);
  return false;
}

interface Body {
  ytId?: string;
  url?: string;
  contentType?: string;
  expiresAt?: string;
  source?: 'desktop' | 'edge' | 'manual';
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Auth: validar JWT.
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'missing token' }, 401);

  // Cliente con anon key + Authorization header del user — usa auth.getUser
  // para validar el JWT contra Supabase Auth.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: 'invalid token' }, 401);

  // Rate-limit per user.
  if (isRateLimited(user.id)) {
    return json({ error: 'rate limited', retryAfter: 60 }, 429);
  }

  // Parse body.
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const { ytId, url, contentType, expiresAt, source } = body;

  if (!ytId || typeof ytId !== 'string' || ytId.length > 32) {
    return json({ error: 'invalid ytId' }, 400);
  }
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return json({ error: 'invalid url' }, 400);
  }
  if (!expiresAt || typeof expiresAt !== 'string') {
    return json({ error: 'invalid expiresAt' }, 400);
  }
  const expiresDate = new Date(expiresAt);
  if (Number.isNaN(expiresDate.getTime())) {
    return json({ error: 'invalid expiresAt date' }, 400);
  }
  // Reject TTLs absurdos: >24h o ya caducados.
  const ttlSec = (expiresDate.getTime() - Date.now()) / 1000;
  if (ttlSec < 60 || ttlSec > 86400) {
    return json({ error: 'expiresAt out of range', ttlSec }, 400);
  }

  // Upsert con service_role.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error } = await admin
    .from('stream_url_cache')
    .upsert({
      yt_id: ytId,
      url,
      content_type: contentType ?? 'audio/mp4',
      expires_at: expiresDate.toISOString(),
      source: source ?? 'desktop',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'yt_id' });

  if (error) {
    console.error('[publish-stream-url] upsert error:', error.message);
    return json({ error: 'upsert failed', detail: error.message }, 502);
  }

  return json({ ok: true, ytId, expiresAt: expiresDate.toISOString() });
});
