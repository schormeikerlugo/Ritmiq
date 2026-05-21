/**
 * Edge Function: send-friend-request
 *
 * Crea una solicitud de amistad y envia push al destinatario.
 *
 * POST /send-friend-request
 * Headers: Authorization: Bearer <JWT>
 * Body: { addresseeId: string }
 *
 * Devuelve: { friendship: { id, status } }
 * Errores: 400 ya_amigos | 400 ya_pendiente | 400 bloqueado | 404 usuario_no_encontrado
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!jwt) return json({ error: 'Unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  let body: { addresseeId?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { addresseeId } = body;
  if (!addresseeId) return json({ error: 'Missing addresseeId' }, 400);
  if (addresseeId === user.id) return json({ error: 'No puedes enviarte una solicitud a ti mismo' }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // Verificar que el destinatario existe
  const { data: addresseeProfile } = await svc
    .from('profiles')
    .select('username, display_name')
    .eq('user_id', addresseeId)
    .single();

  if (!addresseeProfile) return json({ error: 'usuario_no_encontrado' }, 404);

  // Verificar si ya existe una relacion
  const { data: existing } = await svc
    .from('friendships')
    .select('id, status')
    .or(
      `and(requester.eq.${user.id},addressee.eq.${addresseeId}),` +
      `and(requester.eq.${addresseeId},addressee.eq.${user.id})`,
    )
    .maybeSingle();

  if (existing) {
    if (existing.status === 'accepted') return json({ error: 'ya_amigos' }, 400);
    if (existing.status === 'pending')  return json({ error: 'ya_pendiente' }, 400);
    if (existing.status === 'blocked')  return json({ error: 'bloqueado' }, 400);
    // Si fue rejected, permitir reenviar actualizando la fila
    const { data: updated } = await svc
      .from('friendships')
      .update({ status: 'pending', requester: user.id, addressee: addresseeId })
      .eq('id', existing.id)
      .select('id, status')
      .single();
    await notifyFriendRequest(svc, user.id, addresseeId);
    return json({ friendship: updated });
  }

  // Crear solicitud nueva
  const { data: friendship, error: insertErr } = await svc
    .from('friendships')
    .insert({ requester: user.id, addressee: addresseeId, status: 'pending' })
    .select('id, status')
    .single();

  if (insertErr) return json({ error: insertErr.message }, 500);

  // Push notification al destinatario
  await notifyFriendRequest(svc, user.id, addresseeId);

  return json({ friendship });
});

async function notifyFriendRequest(
  svc: ReturnType<typeof createClient>,
  requesterId: string,
  addresseeId: string,
) {
  // Obtener nombre del requester para el mensaje
  const { data: requesterProfile } = await svc
    .from('profiles')
    .select('username, display_name')
    .eq('user_id', requesterId)
    .single();

  const name = requesterProfile?.display_name ?? requesterProfile?.username ?? 'Alguien';

  // Invocar send-push-notification (service role, llamada interna)
  const pushUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`;
  await fetch(pushUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({
      userId: addresseeId,
      title: 'Nueva solicitud de amistad',
      body: `${name} quiere ser tu amigo en Ritmiq`,
      data: { type: 'friend_request', requesterId },
    }),
  }).catch(() => {}); // fire-and-forget
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
