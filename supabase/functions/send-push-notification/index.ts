/**
 * Edge Function: send-push-notification (funcion base interna)
 *
 * Envia una Web Push notification a todos los dispositivos suscritos
 * de un usuario. Usada internamente por send-friend-request y send-share.
 *
 * Solo accesible con service role (no expuesta directamente al cliente).
 *
 * POST /send-push-notification
 * Body: { userId: string, title: string, body: string, data?: object }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hola@ritmiq.app';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  let body: PushPayload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { userId, title, body: msgBody, data = {} } = body;
  if (!userId || !title || !msgBody) {
    return json({ error: 'Missing required fields: userId, title, body' }, 400);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // Obtener todas las suscripciones del usuario
  const { data: subs, error } = await svc
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .eq('user_id', userId);

  if (error) return json({ error: error.message }, 500);
  if (!subs || subs.length === 0) return json({ sent: 0, skipped: 'no_subscriptions' });

  const payload = JSON.stringify({ title, body: msgBody, data });

  // Enviar a cada suscripcion
  const results = await Promise.allSettled(
    subs.map((sub) => sendWebPush(sub.endpoint, sub.p256dh, sub.auth_key, payload)),
  );

  // Limpiar suscripciones expiradas (endpoint devuelve 404/410)
  const expiredEndpoints: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.expired) {
      expiredEndpoints.push(subs[i].endpoint);
    }
  });
  if (expiredEndpoints.length > 0) {
    await svc
      .from('push_subscriptions')
      .delete()
      .in('endpoint', expiredEndpoints);
  }

  const sent = results.filter((r) => r.status === 'fulfilled' && !r.value.expired).length;
  return json({ sent, total: subs.length });
});

// ── VAPID / Web Push ─────────────────────────────────────────────────

async function sendWebPush(
  endpoint: string,
  p256dh: string,
  authKey: string,
  payload: string,
): Promise<{ expired: boolean }> {
  // Importar la libreria web-push desde CDN de Deno
  // Usamos la implementacion nativa con SubtleCrypto para no depender
  // de Node.js crypto en Deno edge runtime.
  const { default: webpush } = await import('npm:web-push@3.6.7');

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  try {
    await webpush.sendNotification(
      { endpoint, keys: { p256dh, auth: authKey } },
      payload,
      { TTL: 86400 }, // 24h TTL
    );
    return { expired: false };
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    // 404 / 410 = endpoint expirado/invalido
    if (status === 404 || status === 410) return { expired: true };
    throw err;
  }
}

// ── tipos ──────────────────────────────────────────────────────────

interface PushPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
