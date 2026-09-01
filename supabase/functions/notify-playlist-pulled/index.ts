/**
 * Edge Function: notify-playlist-pulled
 *
 * Se llama cuando un usuario "jala" (copia) la playlist de otro desde su
 * perfil. Notifica al DUEÑO original:
 *   1. Inserta una fila en `notifications` (bandeja in-app, con realtime).
 *   2. Envía un push best-effort.
 *
 * La inserción usa service-role para que el actor no pueda falsificar
 * notificaciones (RLS de `notifications` solo permite al dueño leer/actualizar).
 * Se valida amistad/visibilidad server-side: solo se notifica si el dueño
 * expone esa playlist como 'public' o 'friends' (y en 'friends', si son
 * amigos). Así no se puede spamear a nadie.
 *
 * POST /notify-playlist-pulled
 * Headers: Authorization: Bearer <JWT>  (el que jala)
 * Body: { ownerId, sourcePlaylistId, playlistName, coverUrl?, trackCount? }
 * Devuelve: { ok: true, notificationId }
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

  let body: {
    ownerId?: string;
    sourcePlaylistId?: string;
    playlistName?: string;
    coverUrl?: string | null;
    trackCount?: number;
  };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { ownerId, sourcePlaylistId, playlistName } = body;
  if (!ownerId || !sourcePlaylistId) return json({ error: 'Missing ownerId/sourcePlaylistId' }, 400);
  if (ownerId === user.id) return json({ ok: true, skipped: 'self' }); // no notificar auto-jalado

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // Validar que la playlist existe, es del ownerId y es realmente visible para
  // el que jala (anti-spam: no puedes notificar por una playlist privada).
  const { data: pl } = await svc
    .from('playlists')
    .select('id, user_id, visibility, name, cover_url')
    .eq('id', sourcePlaylistId)
    .eq('user_id', ownerId)
    .maybeSingle();

  if (!pl) return json({ error: 'Playlist no encontrada' }, 404);
  if (pl.visibility === 'private') return json({ error: 'Playlist privada' }, 403);

  if (pl.visibility === 'friends') {
    const { data: friendship } = await svc
      .from('friendships')
      .select('id')
      .or(
        `and(requester.eq.${user.id},addressee.eq.${ownerId}),` +
        `and(requester.eq.${ownerId},addressee.eq.${user.id})`,
      )
      .eq('status', 'accepted')
      .maybeSingle();
    if (!friendship) return json({ error: 'No autorizado' }, 403);
  }

  // Anti-ruido: si ya notificamos este mismo (owner, actor, playlist) en la
  // última hora, no duplicar.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recent } = await svc
    .from('notifications')
    .select('id')
    .eq('user_id', ownerId)
    .eq('actor_id', user.id)
    .eq('type', 'playlist_pulled')
    .gte('created_at', oneHourAgo)
    .contains('data', { playlistId: sourcePlaylistId })
    .maybeSingle();

  if (recent) return json({ ok: true, deduped: true, notificationId: recent.id });

  // Insertar notificación in-app.
  const { data: notif, error: insErr } = await svc
    .from('notifications')
    .insert({
      user_id:  ownerId,
      actor_id: user.id,
      type:     'playlist_pulled',
      data: {
        playlistId:   sourcePlaylistId,
        playlistName: playlistName ?? pl.name,
        coverUrl:     body.coverUrl ?? pl.cover_url ?? null,
        trackCount:   body.trackCount ?? null,
      },
    })
    .select('id')
    .single();

  if (insErr) return json({ error: insErr.message }, 500);

  // Push best-effort al dueño.
  const { data: actorProfile } = await svc
    .from('profiles')
    .select('username, display_name')
    .eq('user_id', user.id)
    .single();
  const actorName = actorProfile?.display_name ?? actorProfile?.username ?? 'Alguien';

  const badgeCount = await computeBadgeCount(svc, ownerId);

  const pushUrl = `${SUPABASE_URL}/functions/v1/send-push-notification`;
  fetch(pushUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      userId: ownerId,
      title:  `${actorName} guardó tu playlist`,
      body:   playlistName ?? pl.name,
      data: {
        type: 'notification',
        kind: 'playlist_pulled',
        notificationId: notif.id,
        actorId: user.id,
        tag: `notif:${notif.id}`,
        badgeCount,
      },
    }),
  }).catch(() => {});

  return json({ ok: true, notificationId: notif.id });
});

/**
 * Badge = notificaciones no leídas + shares no leídos + solicitudes pendientes.
 * Best-effort.
 */
async function computeBadgeCount(
  svc: ReturnType<typeof createClient>,
  userId: string,
): Promise<number | null> {
  try {
    const [{ count: unreadNotifs }, { count: unreadShares }, { count: pendingReqs }] = await Promise.all([
      svc.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null),
      svc.from('shared_items')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', userId)
        .is('read_at', null),
      svc.from('friendships')
        .select('id', { count: 'exact', head: true })
        .eq('addressee', userId)
        .eq('status', 'pending'),
    ]);
    return (unreadNotifs ?? 0) + (unreadShares ?? 0) + (pendingReqs ?? 0);
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
