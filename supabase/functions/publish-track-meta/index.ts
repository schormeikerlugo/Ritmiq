// Edge Function: publish-track-meta
//
// Recibe del cliente (al reproducir un track exitosamente) un snapshot
// de metadata y lo upserta en `tracks_global`. Fire-and-forget desde
// el caller (no bloquea la reproduccion).
//
// CANONICALIZACION: la PRIMERA contribucion por yt_id define los campos
// title/artist/album/cover/duration. Las subsecuentes solo incrementan
// contribution_count y refrescan last_seen_at. Esto evita que un user
// con metadata mal formateada pise lo que ya esta canonizado.
//
// Auth: Bearer JWT del usuario propietario. Verificamos solo que sea
// un JWT valido — cualquier user autenticado puede contribuir al
// diccionario global.
//
// Rate-limit suave en memoria del isolate: 100 upserts/min por user.
// Si reinicia el isolate se resetea — aceptable para uso normal.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Rate-limit in-memory: userId -> [timestamps].
const rateLimit = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 100;

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const arr = (rateLimit.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    rateLimit.set(userId, arr);
    return true;
  }
  arr.push(now);
  rateLimit.set(userId, arr);
  return false;
}

interface Body {
  ytId?: string;
  title?: string;
  artist?: string;
  album?: string | null;
  coverUrl?: string | null;
  durationSeconds?: number | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Sanea strings de metadata: trim, normalize whitespace, max length.
function clean(s: unknown, max = 500): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.slice(0, max);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Auth: validar JWT.
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'missing token' }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: 'invalid token' }, 401);

  // Rate-limit per user.
  if (isRateLimited(user.id)) {
    return json({ error: 'rate limited', retryAfter: 60 }, 429);
  }

  // Parse body.
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const ytId = clean(body.ytId, 32);
  const title = clean(body.title, 500);
  const artist = clean(body.artist, 500);
  const album = clean(body.album, 500);
  const coverUrl = clean(body.coverUrl, 1000);
  const durationSeconds = typeof body.durationSeconds === 'number'
    && Number.isFinite(body.durationSeconds)
    && body.durationSeconds > 0
    && body.durationSeconds < 86400
      ? Math.round(body.durationSeconds)
      : null;

  if (!ytId || !/^[\w-]{11}$/.test(ytId)) {
    return json({ error: 'invalid ytId' }, 400);
  }
  if (!title) return json({ error: 'invalid title' }, 400);
  if (!artist) return json({ error: 'invalid artist' }, 400);

  // UPSERT canonicalizante: la primera contribucion define los campos,
  // las subsecuentes solo incrementan counter y refrescan last_seen_at.
  // Hacemos un SELECT primero para distinguir INSERT vs UPDATE (no se
  // puede expresar "increment-on-conflict" en supabase-js upsert).
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: existing, error: selErr } = await admin
    .from('tracks_global')
    .select('yt_id, contribution_count')
    .eq('yt_id', ytId)
    .maybeSingle();

  if (selErr) {
    console.error('[publish-track-meta] select error:', selErr.message);
    return json({ error: 'lookup failed', detail: selErr.message }, 502);
  }

  if (existing) {
    // Subsecuente: solo incrementa counter y refresca last_seen_at.
    const { error: updErr } = await admin
      .from('tracks_global')
      .update({
        last_seen_at: new Date().toISOString(),
        contribution_count: (existing.contribution_count ?? 0) + 1,
      })
      .eq('yt_id', ytId);
    if (updErr) {
      console.error('[publish-track-meta] update error:', updErr.message);
      return json({ error: 'update failed', detail: updErr.message }, 502);
    }
    return json({ ok: true, ytId, action: 'incremented' });
  }

  // Primera contribucion: INSERT canonicalizante.
  const { error: insErr } = await admin
    .from('tracks_global')
    .insert({
      yt_id: ytId,
      title,
      artist,
      album,
      cover_url: coverUrl,
      duration_seconds: durationSeconds,
    });
  if (insErr) {
    // Race condition: otro request inserto entre nuestro select y este
    // insert. Reintentamos como update.
    if (insErr.code === '23505') {
      const { error: retryErr } = await admin
        .from('tracks_global')
        .update({
          last_seen_at: new Date().toISOString(),
          contribution_count: 2, // ya hubo al menos una; este es la segunda.
        })
        .eq('yt_id', ytId);
      if (retryErr) {
        return json({ error: 'race retry failed', detail: retryErr.message }, 502);
      }
      return json({ ok: true, ytId, action: 'incremented_after_race' });
    }
    console.error('[publish-track-meta] insert error:', insErr.message);
    return json({ error: 'insert failed', detail: insErr.message }, 502);
  }

  return json({ ok: true, ytId, action: 'canonicalized' });
});
