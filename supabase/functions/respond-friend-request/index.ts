/**
 * Edge Function: respond-friend-request
 *
 * Acepta o rechaza una solicitud de amistad pendiente.
 * Solo el addressee puede responder.
 *
 * POST /respond-friend-request
 * Headers: Authorization: Bearer <JWT>
 * Body: { friendshipId: string, action: 'accept' | 'reject' | 'block' }
 *
 * Devuelve: { friendship: { id, status } }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
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

  let body: { friendshipId?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { friendshipId, action } = body;
  if (!friendshipId || !action) return json({ error: 'Missing friendshipId or action' }, 400);
  if (!['accept', 'reject', 'block'].includes(action)) {
    return json({ error: 'action must be accept | reject | block' }, 400);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // Verificar que la solicitud existe y el usuario es el addressee
  const { data: friendship } = await svc
    .from('friendships')
    .select('id, status, requester, addressee')
    .eq('id', friendshipId)
    .single();

  if (!friendship) return json({ error: 'Solicitud no encontrada' }, 404);
  if (friendship.addressee !== user.id) return json({ error: 'No autorizado' }, 403);
  if (friendship.status !== 'pending' && action !== 'block') {
    return json({ error: 'La solicitud ya fue respondida' }, 400);
  }

  const newStatus = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'blocked';

  const { data: updated } = await svc
    .from('friendships')
    .update({ status: newStatus })
    .eq('id', friendshipId)
    .select('id, status')
    .single();

  // Si se acepto, notificar al requester
  if (action === 'accept') {
    const { data: accepterProfile } = await svc
      .from('profiles')
      .select('username, display_name')
      .eq('user_id', user.id)
      .single();

    const name = accepterProfile?.display_name ?? accepterProfile?.username ?? 'Alguien';

    const pushUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`;
    fetch(pushUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        userId: friendship.requester,
        title: 'Solicitud aceptada',
        body: `${name} aceptó tu solicitud de amistad`,
        data: { type: 'friend_accepted', friendId: user.id },
      }),
    }).catch(() => {});
  }

  return json({ friendship: updated });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
