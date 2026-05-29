// Edge Function: recomendaciones basadas en YouTube "watch next" autoplay
// queue (Innertube). Fuente alternativa a Last.fm.
//
// A diferencia de [recommendations]:
//   - No requiere Last.fm API key.
//   - Devuelve videos relacionados al seedYtId desde la red de YouTube
//     (que ya considera engagement, embeddings, etc).
//   - Captura tracks recientes que Last.fm tarda en indexar.
//   - Cubre mejor el catalogo latino que Last.fm.
//
// Limitaciones:
//   - Solo funciona con un seed videoId (un track en concreto).
//   - Los autores ("artistas") vienen del shortBylineText del canal de
//     YouTube, que NO siempre es el artista real (canales "<Artist> -
//     Topic" generan ruido).
//
// Endpoint:
//   GET /yt-recs?seed=<ytId>
//   Headers: Authorization: Bearer <user JWT>
//
// Respuesta:
//   {
//     seed: string,
//     tracks: Array<{ ytId, title, artist, thumbnail, duration }>,
//     generatedAt: string,
//     cached: boolean,
//   }
//
// Cache server-side: TTL 6h por seedYtId (mas corto que recommendations
// 12h porque YouTube refresca su autoplay queue con frecuencia).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ytNext } from '../_shared/innertube.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const CACHE_TTL_MS = 6 * 3600_000;
const MAX_TRACKS = 20;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  if (!req.headers.get('authorization')) {
    return json({ error: 'unauthorized' }, 401);
  }

  const url = new URL(req.url);
  const seedYtId = (url.searchParams.get('seed') ?? '').trim();
  if (!seedYtId || !/^[A-Za-z0-9_-]{8,15}$/.test(seedYtId)) {
    return json({ error: 'seed debe ser un ytId valido (8-15 chars alfanumericos)' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Identificamos al user (su user_id va en el cache; la fuente no
  // depende del usuario pero la tabla `recommendation_cache` tiene FK
  // a auth.users en user_id, asi que no podemos usar zeros).
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'no autenticado' }, 401);

  // Cache key: hash del seedYtId (la fuente NO depende del usuario,
  // YouTube devuelve lo mismo para todos los anonimos). El user_id se
  // guarda solo para satisfacer la FK; varios users con el mismo
  // seedYtId comparten cache via el cache_key.
  const cacheKey = await sha256Hex(`yt-recs:${seedYtId}`);

  try {
    const { data: cached } = await admin
      .from('recommendation_cache')
      .select('payload, refreshed_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (cached?.refreshed_at) {
      const age = Date.now() - new Date(cached.refreshed_at).getTime();
      if (age < CACHE_TTL_MS) {
        return json({ ...(cached.payload as object), cached: true });
      }
    }
  } catch (e) {
    console.warn('[yt-recs] cache read failed', (e as Error).message);
  }

  let tracks;
  try {
    tracks = await ytNext(seedYtId);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502);
  }

  if (tracks.length === 0) {
    return json({ error: 'sin tracks relacionados' }, 404);
  }

  tracks = tracks.slice(0, MAX_TRACKS);

  const payload = {
    seed: seedYtId,
    tracks,
    generatedAt: new Date().toISOString(),
  };

  try {
    await admin.from('recommendation_cache').upsert({
      cache_key: cacheKey,
      user_id: user.id,                  // satisface FK; cache compartido via cache_key
      kind: 'yt-recs',
      seed: seedYtId,
      payload,
      refreshed_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });
  } catch (e) {
    console.warn('[yt-recs] cache write failed', (e as Error).message);
  }

  return json({ ...payload, cached: false });
});
