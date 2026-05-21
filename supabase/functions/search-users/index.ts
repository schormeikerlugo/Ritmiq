/**
 * Edge Function: search-users
 *
 * Busca perfiles por @username (prefijo) o por email exacto.
 * Rate-limited: max 20 req/min por usuario via contador en memoria
 * (suficiente para un MVP — migrar a Redis/KV si crece).
 *
 * GET /search-users?q=<query>&limit=10
 *   - Si q empieza con '@' busca por username (prefix ILIKE).
 *   - Si q contiene '@' sin ser el primer char, busca por email exacto
 *     en auth.users (requiere service role).
 *   - En otro caso, busca por username prefix.
 *
 * Devuelve: { users: [{ userId, username, displayName, avatarUrl, friendshipStatus }] }
 * friendshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'blocked'
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Autenticar al usuario que hace la busqueda
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!jwt) return json({ error: 'Unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  const url    = new URL(req.url);
  const raw    = (url.searchParams.get('q') ?? '').trim();
  const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '10', 10), 20);

  if (raw.length < 2) return json({ users: [] });

  // Service role para leer auth.users (email) y todos los profiles
  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  let profiles: Profile[] = [];

  const isEmailSearch = raw.includes('@') && !raw.startsWith('@');
  if (isEmailSearch) {
    // Buscar por email exacto en auth.users
    const { data: authUsers } = await svc.auth.admin.listUsers();
    const match = (authUsers?.users ?? []).find(
      (u) => u.email?.toLowerCase() === raw.toLowerCase() && u.id !== user.id,
    );
    if (match) {
      const { data } = await svc
        .from('profiles')
        .select('user_id, username, display_name, avatar_url')
        .eq('user_id', match.id)
        .single();
      if (data) profiles = [data];
    }
  } else {
    // Buscar por username (prefijo, case-insensitive)
    const q = raw.startsWith('@') ? raw.slice(1) : raw;
    const { data } = await svc
      .from('profiles')
      .select('user_id, username, display_name, avatar_url')
      .ilike('username', `${q}%`)
      .neq('user_id', user.id)
      .limit(limit);
    profiles = data ?? [];
  }

  if (profiles.length === 0) return json({ users: [] });

  // Enriquecer con estado de amistad desde el punto de vista del buscador
  const friendIds = profiles.map((p) => p.user_id);
  const { data: friendships } = await userClient
    .from('friendships')
    .select('requester, addressee, status')
    .or(
      `and(requester.eq.${user.id},addressee.in.(${friendIds.join(',')})),` +
      `and(addressee.eq.${user.id},requester.in.(${friendIds.join(',')}))`,
    );

  const fsMap = new Map<string, string>();
  for (const fs of (friendships ?? [])) {
    const otherId = fs.requester === user.id ? fs.addressee : fs.requester;
    let status = fs.status;
    if (status === 'pending') {
      status = fs.requester === user.id ? 'pending_sent' : 'pending_received';
    }
    fsMap.set(otherId, status);
  }

  const users = profiles.map((p) => ({
    userId:           p.user_id,
    username:         p.username,
    displayName:      p.display_name ?? null,
    avatarUrl:        p.avatar_url ?? null,
    friendshipStatus: (fsMap.get(p.user_id) ?? 'none') as string,
  }));

  return json({ users });
});

// ── helpers ──────────────────────────────────────────────────────────

interface Profile {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
