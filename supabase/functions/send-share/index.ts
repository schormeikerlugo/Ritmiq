/**
 * Edge Function: send-share
 *
 * Comparte un track o playlist con un amigo mutuo.
 * Solo funciona entre amigos (status='accepted').
 *
 * POST /send-share
 * Headers: Authorization: Bearer <JWT>
 * Body (track):
 *   { receiverId, kind:'track', ytId, title, artist, coverUrl, durationSeconds, message? }
 * Body (playlist):
 *   { receiverId, kind:'playlist', playlistName, playlistSnapshot: {tracks:[...]}, message? }
 *
 * Devuelve: { item: { id, kind, createdAt } }
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

  let body: ShareBody;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { receiverId, kind, message } = body;
  if (!receiverId || !kind) return json({ error: 'Missing receiverId or kind' }, 400);
  if (!['track', 'playlist'].includes(kind)) return json({ error: 'kind must be track | playlist' }, 400);
  if (receiverId === user.id) return json({ error: 'No puedes compartir contigo mismo' }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // Verificar que son amigos mutuos
  const { data: friendship } = await svc
    .from('friendships')
    .select('id, status')
    .or(
      `and(requester.eq.${user.id},addressee.eq.${receiverId}),` +
      `and(requester.eq.${receiverId},addressee.eq.${user.id})`,
    )
    .eq('status', 'accepted')
    .maybeSingle();

  if (!friendship) return json({ error: 'Solo puedes compartir con amigos' }, 403);

  // Construir el registro segun el kind
  const record: Record<string, unknown> = {
    sender_id:   user.id,
    receiver_id: receiverId,
    kind,
    message:     message?.slice(0, 280) ?? null,
  };

  if (kind === 'track') {
    const { ytId, title, artist, coverUrl, durationSeconds } = body as TrackShareBody;
    if (!ytId) return json({ error: 'Missing ytId for track share' }, 400);
    Object.assign(record, {
      yt_id:            ytId,
      title,
      artist,
      cover_url:        coverUrl,
      duration_seconds: durationSeconds,
    });
  } else {
    const { playlistName, playlistSnapshot } = body as PlaylistShareBody;
    if (!playlistSnapshot?.tracks?.length) return json({ error: 'Empty playlist' }, 400);
    Object.assign(record, {
      playlist_name:     playlistName,
      playlist_snapshot: playlistSnapshot,
    });
  }

  const { data: item, error: insertErr } = await svc
    .from('shared_items')
    .insert(record)
    .select('id, kind, created_at')
    .single();

  if (insertErr) return json({ error: insertErr.message }, 500);

  // Push notification al receptor
  const { data: senderProfile } = await svc
    .from('profiles')
    .select('username, display_name')
    .eq('user_id', user.id)
    .single();

  const senderName = senderProfile?.display_name ?? senderProfile?.username ?? 'Un amigo';
  const itemName   = kind === 'track'
    ? (body as TrackShareBody).title ?? 'un track'
    : (body as PlaylistShareBody).playlistName ?? 'una playlist';

  const pushUrl = `${SUPABASE_URL}/functions/v1/send-push-notification`;
  fetch(pushUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      userId: receiverId,
      title:  `${senderName} te compartio ${kind === 'track' ? 'un track' : 'una playlist'}`,
      body:   itemName,
      data:   { type: 'share', kind, itemId: item.id, senderId: user.id },
    }),
  }).catch(() => {});

  return json({ item });
});

// ── tipos ──────────────────────────────────────────────────────────

interface ShareBody {
  receiverId: string;
  kind: 'track' | 'playlist';
  message?: string;
}
interface TrackShareBody extends ShareBody {
  ytId: string;
  title?: string;
  artist?: string;
  coverUrl?: string;
  durationSeconds?: number;
}
interface PlaylistShareBody extends ShareBody {
  playlistName?: string;
  playlistSnapshot: { tracks: unknown[] };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
