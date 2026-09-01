/**
 * Edge Function: get-profile-playlists
 *
 * Devuelve las playlists VISIBLES de un usuario (el "anfitrión" del perfil)
 * para que otro usuario las descubra y las "jale". Respeta la visibilidad:
 *   - 'public'  → visible para cualquier usuario autenticado.
 *   - 'friends' → visible solo si el que pregunta es amigo mutuo aceptado.
 *   - 'private' → nunca se devuelve.
 *
 * La metadata de los tracks se resuelve con service-role (no se abre RLS de
 * `tracks`), así el que pregunta NO ve la biblioteca completa del anfitrión,
 * solo los tracks que pertenecen a playlists visibles.
 *
 * POST /get-profile-playlists
 * Headers: Authorization: Bearer <JWT>
 * Body: { ownerId }
 * Devuelve: { playlists: [{ id, name, coverUrl, visibility, trackCount,
 *                           tracks: [{ ytId, title, artist, coverUrl, durationSeconds }] }] }
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

  let body: { ownerId?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const ownerId = body.ownerId;
  if (!ownerId) return json({ error: 'Missing ownerId' }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // ¿Es el propio perfil? Entonces ve todas menos privadas igualmente aquí no
  // aplica (para tu propio perfil usas tus playlists locales). Si es amigo,
  // suma las 'friends'. Si no, solo 'public'.
  let isFriend = false;
  if (ownerId !== user.id) {
    const { data: friendship } = await svc
      .from('friendships')
      .select('id')
      .or(
        `and(requester.eq.${user.id},addressee.eq.${ownerId}),` +
        `and(requester.eq.${ownerId},addressee.eq.${user.id})`,
      )
      .eq('status', 'accepted')
      .maybeSingle();
    isFriend = !!friendship;
  } else {
    isFriend = true; // tu propio perfil: ves friends + public (no privadas)
  }

  const allowed = isFriend ? ['public', 'friends'] : ['public'];

  // Playlists visibles del anfitrión.
  const { data: playlists, error: plErr } = await svc
    .from('playlists')
    .select('id, name, cover_url, visibility, sort_key, created_at')
    .eq('user_id', ownerId)
    .in('visibility', allowed)
    .order('sort_key', { ascending: false })
    .order('created_at', { ascending: true });

  if (plErr) return json({ error: 'db error', detail: plErr.message }, 500);
  if (!playlists || playlists.length === 0) return json({ playlists: [] });

  const playlistIds = playlists.map((p) => p.id);

  // Membresías (playlist_id, track_id, position) de todas las visibles.
  const { data: memberships } = await svc
    .from('playlist_tracks')
    .select('playlist_id, track_id, position')
    .in('playlist_id', playlistIds)
    .order('position', { ascending: true });

  const trackIds = [...new Set((memberships ?? []).map((m) => m.track_id))];

  // Metadata de esos tracks (solo los que están en playlists visibles).
  let trackMap = new Map<string, any>();
  if (trackIds.length > 0) {
    const { data: tracks } = await svc
      .from('tracks')
      .select('id, yt_id, title, artist, cover_url, duration_seconds')
      .in('id', trackIds);
    trackMap = new Map((tracks ?? []).map((t) => [t.id, t]));
  }

  // Ensamblar snapshots por playlist, en orden de posición.
  const byPlaylist = new Map<string, any[]>();
  for (const m of memberships ?? []) {
    const t = trackMap.get(m.track_id);
    if (!t || !t.yt_id) continue; // solo tracks de YouTube jalables
    const arr = byPlaylist.get(m.playlist_id) ?? [];
    arr.push({
      ytId:            t.yt_id,
      title:           t.title ?? null,
      artist:          t.artist ?? null,
      coverUrl:        t.cover_url ?? null,
      durationSeconds: t.duration_seconds ?? null,
    });
    byPlaylist.set(m.playlist_id, arr);
  }

  const result = playlists.map((p) => {
    const tracks = byPlaylist.get(p.id) ?? [];
    return {
      id:         p.id,
      name:       p.name,
      coverUrl:   p.cover_url ?? null,
      visibility: p.visibility,
      trackCount: tracks.length,
      tracks,
    };
  });

  return json({ playlists: result });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
