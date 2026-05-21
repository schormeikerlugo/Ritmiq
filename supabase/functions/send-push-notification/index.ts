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

  // Clasificar resultados:
  //   - expired (404/410): borrar fila + NO loguear (comportamiento esperado).
  //   - error (otro statusCode o exception): loguear para diagnostico.
  //   - ok: no loguear (volumen alto, sin valor).
  const expiredEndpoints: string[] = [];
  const errorLogs: Array<{
    endpoint: string;
    user_id: string;
    status_code: number;
    error_msg: string | null;
  }> = [];

  results.forEach((r, i) => {
    const sub = subs[i];
    if (r.status === 'fulfilled') {
      if (r.value.expired) {
        expiredEndpoints.push(sub.endpoint);
      } else if (r.value.error) {
        errorLogs.push({
          endpoint:    sub.endpoint,
          user_id:     userId,
          status_code: r.value.statusCode ?? 0,
          error_msg:   r.value.error,
        });
      }
    } else {
      // Rejection (exception en sendWebPush).
      errorLogs.push({
        endpoint:    sub.endpoint,
        user_id:     userId,
        status_code: 0,
        error_msg:   String(r.reason).slice(0, 500),
      });
    }
  });

  if (expiredEndpoints.length > 0) {
    await svc
      .from('push_subscriptions')
      .delete()
      .in('endpoint', expiredEndpoints);
  }

  // Log de fallos para diagnostico operativo (best-effort, no
  // bloqueante \u2014 si la tabla no existe aun la insercion falla
  // silenciosamente y el push sigue funcionando).
  if (errorLogs.length > 0) {
    await svc
      .from('push_delivery_log')
      .insert(errorLogs)
      .then(({ error: logErr }) => {
        if (logErr) console.warn('[push] delivery log insert failed', logErr.message);
      });
  }

  const sent = results.filter((r) => r.status === 'fulfilled' && !r.value.expired && !r.value.error).length;
  return json({ sent, total: subs.length, errors: errorLogs.length });
});

// ── VAPID / Web Push ─────────────────────────────────────────────────

interface PushResult {
  expired: boolean;
  error?: string;
  statusCode?: number;
}

async function sendWebPush(
  endpoint: string,
  p256dh: string,
  authKey: string,
  payload: string,
): Promise<PushResult> {
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
    const e = err as { statusCode?: number; body?: string; message?: string };
    const status = e.statusCode;
    // 404 / 410 = endpoint expirado/invalido (comportamiento esperado,
    // el cliente perdio el SW o se reinstalo la PWA). NO se loguea.
    if (status === 404 || status === 410) return { expired: true };
    // Otros errores: 429 throttling, 4xx VAPID/payload, 5xx servicio.
    // Devolvemos info para logging \u2014 NO re-throw para no romper el
    // Promise.allSettled.
    return {
      expired: false,
      statusCode: status,
      error: (e.body ?? e.message ?? 'unknown').slice(0, 500),
    };
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
