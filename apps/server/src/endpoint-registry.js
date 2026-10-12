/**
 * Publicación del endpoint del SERVIDOR (kind='server') en Supabase, para
 * que la PWA del dueño (y cuentas pareadas) descubran la URL del túnel sin
 * pasos manuales — igual que hace el desktop con su propio endpoint.
 *
 * El servidor headless NO tiene sesión interactiva, así que se autentica
 * como el DUEÑO usando credenciales de entorno:
 *   - RITMIQ_OWNER_EMAIL + RITMIQ_OWNER_PASSWORD   (recomendado), o
 *   - RITMIQ_OWNER_ACCESS_TOKEN (+ RITMIQ_OWNER_REFRESH_TOKEN)  (avanzado).
 *
 * Si no hay credenciales, la publicación se omite (el endpoint sigue siendo
 * accesible en LAN o por la URL del túnel compartida manualmente).
 *
 * @module @ritmiq/server/endpoint-registry
 */
import { createSupabase } from '@ritmiq/api/supabase';

let clientPromise = null;
let ownerUserId = null;

function getConfig() {
  return {
    url: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
    anon: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    email: process.env.RITMIQ_OWNER_EMAIL || '',
    password: process.env.RITMIQ_OWNER_PASSWORD || '',
    accessToken: process.env.RITMIQ_OWNER_ACCESS_TOKEN || '',
    refreshToken: process.env.RITMIQ_OWNER_REFRESH_TOKEN || '',
  };
}

/** Crea (una vez) un cliente Supabase autenticado como el dueño. */
async function getOwnerClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const cfg = getConfig();
    if (!cfg.url || !cfg.anon) {
      console.warn('[endpoint-registry] sin VITE_SUPABASE_URL/ANON_KEY — no se publica el endpoint');
      return null;
    }
    if (!cfg.email && !cfg.accessToken) {
      console.warn('[endpoint-registry] sin credenciales de dueño (RITMIQ_OWNER_EMAIL/PASSWORD) — no se publica el endpoint');
      return null;
    }
    const sb = createSupabase(cfg.url, cfg.anon);
    try {
      if (cfg.accessToken) {
        await sb.auth.setSession({
          access_token: cfg.accessToken,
          refresh_token: cfg.refreshToken || cfg.accessToken,
        });
      } else {
        const { error } = await sb.auth.signInWithPassword({
          email: cfg.email, password: cfg.password,
        });
        if (error) throw error;
      }
      const { data } = await sb.auth.getUser();
      ownerUserId = data?.user?.id ?? null;
      if (!ownerUserId) throw new Error('no se pudo resolver el user del dueño');
      console.log('[endpoint-registry] autenticado como dueño:', data.user.email);
      return sb;
    } catch (e) {
      console.warn('[endpoint-registry] auth del dueño falló:', e?.message ?? e);
      return null;
    }
  })();
  return clientPromise;
}

/**
 * Publica (upsert) el endpoint del servidor.
 * @param {string} url  URL pública del túnel.
 * @param {'quick'|'named'|'custom'} source
 * @param {string} accessToken  Bearer del LAN server (para clientes).
 */
export async function publishServerEndpoint(url, source, accessToken) {
  const sb = await getOwnerClient();
  if (!sb || !ownerUserId || !url) return;
  const { error } = await sb.from('tunnel_endpoints').upsert({
    user_id: ownerUserId,
    kind: 'server',
    url,
    source,
    access_token: accessToken ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind' });
  if (error) console.warn('[endpoint-registry] upsert falló:', error.message);
  else console.log('[endpoint-registry] endpoint del servidor publicado');
}

/** Borra el endpoint del servidor (al apagar). */
export async function clearServerEndpoint() {
  const sb = await getOwnerClient();
  if (!sb || !ownerUserId) return;
  await sb.from('tunnel_endpoints')
    .delete()
    .eq('user_id', ownerUserId)
    .eq('kind', 'server');
}

/**
 * Devuelve el access_token (JWT) actual de la sesión del dueño, refrescándolo
 * si está por expirar. Lo usa el servidor para alimentar `setSupabaseUserJwt`
 * del lan-server, habilitando el cache global de URLs (leer y publicar).
 *
 * @returns {Promise<string|null>}
 */
export async function getOwnerAccessToken() {
  const sb = await getOwnerClient();
  if (!sb) return null;
  try {
    // getSession no refresca si expiró; forzamos refresh con margen amplio
    // (el JWT dura ~1h y el caller sincroniza cada 10 min). Antes el margen
    // era 2 min con sync cada 30 min: si el autoRefresh interno fallaba en
    // silencio, se seguía entregando un JWT caducado → 401 "invalid token"
    // en publish-stream-url y el cache global quedaba roto.
    const { data: { session } } = await sb.auth.getSession();
    const expMs = (session?.expires_at ?? 0) * 1000;
    if (session && expMs > Date.now() + 15 * 60_000) return session.access_token ?? null;

    const { data, error } = await sb.auth.refreshSession();
    if (!error && data?.session?.access_token) return data.session.access_token;

    // Refresh imposible (refresh token rotado/revocado): re-login completo.
    console.warn('[endpoint-registry] refresh del token del dueño falló, re-login:', error?.message ?? 'sin sesión');
    clientPromise = null;
    ownerUserId = null;
    const fresh = await getOwnerClient();
    if (!fresh) return null;
    const { data: { session: s2 } } = await fresh.auth.getSession();
    return s2?.access_token ?? null;
  } catch (e) {
    console.warn('[endpoint-registry] getOwnerAccessToken falló:', e?.message ?? e);
    return null;
  }
}

/**
 * yt_id de todas las bibliotecas + historial reciente, ordenados por
 * prioridad (RPC get_prefetch_targets; solo responde a la cuenta del
 * servidor listada en prefetch_principals).
 *
 * @param {number} [limit]
 * @returns {Promise<string[]>}
 */
export async function fetchPrefetchTargets(limit = 3000) {
  const sb = await getOwnerClient();
  if (!sb) return [];
  // PostgREST corta cada respuesta a 1000 filas (max_rows): paginar.
  const PAGE = 1000;
  const out = [];
  for (let from = 0; from < limit; from += PAGE) {
    const { data, error } = await sb
      .rpc('get_prefetch_targets', { p_limit: limit })
      .range(from, Math.min(from + PAGE, limit) - 1);
    if (error) {
      console.warn('[endpoint-registry] get_prefetch_targets falló:', error.message);
      break;
    }
    for (const r of data ?? []) out.push(r.yt_id);
    if (!data || data.length < PAGE) break;
  }
  return out;
}
