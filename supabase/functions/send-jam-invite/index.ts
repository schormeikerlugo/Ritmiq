/**
 * Edge Function: send-jam-invite
 *
 * Invita a un amigo mutuo a una jam ya creada (el caller debe ser el host
 * de esa jam). Solo funciona entre amigos (friendships status='accepted').
 *
 * POST /send-jam-invite
 * Headers: Authorization: Bearer <JWT>
 * Body: { receiverId, sessionId }
 *
 * Devuelve: { invite: { id, code, createdAt } }
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!jwt) return json({ error: 'Unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  let body: { receiverId?: string; sessionId?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { receiverId, sessionId } = body;
  if (!receiverId || !sessionId) return json({ error: 'Missing receiverId or sessionId' }, 400);
  if (receiverId === user.id) return json({ error: 'No puedes invitarte a ti mismo' }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Verificar amistad mutua.
  const { data: friendship } = await svc
    .from('friendships')
    .select('id')
    .or(
      `and(requester.eq.${user.id},addressee.eq.${receiverId}),` +
      `and(requester.eq.${receiverId},addressee.eq.${user.id})`,
    )
    .eq('status', 'accepted')
    .maybeSingle();

  if (!friendship) return json({ error: 'Solo puedes invitar a amigos' }, 403);

  // 2) Verificar que la jam existe y que el caller es el host.
  const { data: session } = await svc
    .from('jam_sessions')
    .select('id, code, host_id')
    .eq('id', sessionId)
    .maybeSingle();

  if (!session) return json({ error: 'La jam no existe' }, 404);
  if (session.host_id !== user.id) return json({ error: 'Solo el host puede invitar' }, 403);

  // 3) Evitar invitaciones duplicadas pendientes a la misma persona/jam.
  const { data: existing } = await svc
    .from('jam_invites')
    .select('id')
    .eq('session_id', sessionId)
    .eq('receiver_id', receiverId)
    .eq('status', 'pending')
    .maybeSingle();

  if (existing) return json({ invite: { id: existing.id, code: session.code, duplicate: true } });

  // 4) Insertar la invitacion.
  const { data: invite, error: insertErr } = await svc
    .from('jam_invites')
    .insert({
      sender_id:   user.id,
      receiver_id: receiverId,
      session_id:  sessionId,
      code:        session.code,
      status:      'pending',
    })
    .select('id, code, created_at')
    .single();

  if (insertErr) return json({ error: insertErr.message }, 500);

  // 5) Push al receptor.
  const { data: senderProfile } = await svc
    .from('profiles')
    .select('username, display_name')
    .eq('user_id', user.id)
    .single();

  const senderName = senderProfile?.display_name ?? senderProfile?.username ?? 'Un amigo';
  const badgeCount = await computeBadgeCount(svc, receiverId);

  const pushUrl = `${SUPABASE_URL}/functions/v1/send-push-notification`;
  fetch(pushUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      userId: receiverId,
      title:  `${senderName} te invitó a una jam`,
      body:   'Escuchen música juntos en tiempo real',
      data:   {
        type: 'jam_invite',
        inviteId: invite.id,
        code: session.code,
        senderId: user.id,
        tag: `jam-invite:${invite.id}`,
        badgeCount,
      },
    }),
  }).catch(() => {});

  return json({ invite });
});

/**
 * Badge count del receptor: invitaciones de jam pendientes + shares no
 * leidos + solicitudes de amistad pendientes.
 */
async function computeBadgeCount(
  svc: ReturnType<typeof createClient>,
  userId: string,
): Promise<number | null> {
  try {
    const [{ count: pendingInvites }, { count: unreadShares }, { count: pendingReqs }] = await Promise.all([
      svc.from('jam_invites')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', userId)
        .eq('status', 'pending'),
      svc.from('shared_items')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', userId)
        .is('read_at', null),
      svc.from('friendships')
        .select('id', { count: 'exact', head: true })
        .eq('addressee', userId)
        .eq('status', 'pending'),
    ]);
    return (pendingInvites ?? 0) + (unreadShares ?? 0) + (pendingReqs ?? 0);
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
