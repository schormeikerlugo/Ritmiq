/**
 * Edge Function: respond-jam-invite
 *
 * Acepta o rechaza una invitacion a una jam. Solo el receiver puede.
 * - accept: devuelve el code para que el cliente haga joinSession(code).
 * - reject: notifica al host (sender) con un push.
 *
 * POST /respond-jam-invite
 * Headers: Authorization: Bearer <JWT>
 * Body: { inviteId: string, action: 'accept' | 'reject' }
 *
 * Devuelve: { invite: { id, status, code } }
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

  let body: { inviteId?: string; action?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { inviteId, action } = body;
  if (!inviteId || !action) return json({ error: 'Missing inviteId or action' }, 400);
  if (!['accept', 'reject'].includes(action)) {
    return json({ error: 'action must be accept | reject' }, 400);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // Verificar invitacion + que el caller es el receiver.
  const { data: invite } = await svc
    .from('jam_invites')
    .select('id, status, sender_id, receiver_id, code')
    .eq('id', inviteId)
    .single();

  if (!invite) return json({ error: 'Invitación no encontrada' }, 404);
  if (invite.receiver_id !== user.id) return json({ error: 'No autorizado' }, 403);
  if (invite.status !== 'pending') return json({ error: 'La invitación ya fue respondida' }, 400);

  const newStatus = action === 'accept' ? 'accepted' : 'rejected';

  const { data: updated } = await svc
    .from('jam_invites')
    .update({ status: newStatus, responded_at: new Date().toISOString() })
    .eq('id', inviteId)
    .select('id, status, code')
    .single();

  // En reject: avisar al host (sender) que la invitacion fue rechazada.
  if (action === 'reject') {
    const { data: receiverProfile } = await svc
      .from('profiles')
      .select('username, display_name')
      .eq('user_id', user.id)
      .single();

    const name = receiverProfile?.display_name ?? receiverProfile?.username ?? 'Tu amigo';
    const badgeCount = await computeBadgeCount(svc, invite.sender_id);

    const pushUrl = `${SUPABASE_URL}/functions/v1/send-push-notification`;
    fetch(pushUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        userId: invite.sender_id,
        title: 'Invitación a jam rechazada',
        body: `${name} no se unió a tu jam`,
        data: {
          type: 'jam_invite_rejected',
          inviteId: invite.id,
          friendId: user.id,
          tag: `jam-invite-rej:${invite.id}`,
          badgeCount,
        },
      }),
    }).catch(() => {});
  }

  return json({ invite: updated });
});

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
