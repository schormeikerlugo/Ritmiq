/**
 * Tunnel registry — publicación/suscripción de la URL pública del tunnel
 * Cloudflare a través de Supabase (tabla `tunnel_endpoints`).
 *
 * - Desktop publica su URL actual cada vez que cloudflared reporta una nueva.
 * - PWA observa la tabla (Realtime + pull inicial) y actualiza el localStorage
 *   `ritmiq:lan:tunnelUrl` automáticamente, para que cuando la red WiFi caiga
 *   o el usuario salga de casa, el cliente apunte sin intervención manual al
 *   tunnel actualizado.
 *
 * El Quick Tunnel genera una URL distinta en cada arranque, este registry
 * resuelve ese problema.
 */
import { supabase } from './supabase.js';
import {
  setTunnelUrl, getTunnelUrlSync,
  setAccessToken, getAccessTokenSync,
} from './lan-client.js';

/**
 * Desktop: publica (upsert) la URL del tunnel + access token para el usuario
 * actual. Permite a la PWA del mismo usuario reconectarse sin pegar nada.
 * No falla si no hay sesión (silencia errores).
 *
 * @param {string} userId
 * @param {string} url
 * @param {'quick'|'named'|'custom'} [source]
 * @param {string|null} [accessToken]
 */
export async function publishTunnelUrl(userId, url, source = 'quick', accessToken = null) {
  if (!userId || !url) return;
  try {
    const payload = {
      user_id: userId,
      url,
      source,
      updated_at: new Date().toISOString(),
    };
    if (accessToken) payload.access_token = accessToken;
    const { error } = await supabase
      .from('tunnel_endpoints')
      .upsert(payload, { onConflict: 'user_id' });
    if (error) console.warn('[tunnel-registry] publish:', error.message);
  } catch (e) {
    console.warn('[tunnel-registry] publish failed:', e?.message ?? e);
  }
}

/**
 * Desktop: borra la entrada (cuando el tunnel se detiene manualmente).
 * @param {string} userId
 */
export async function clearTunnelUrl(userId) {
  if (!userId) return;
  try {
    await supabase.from('tunnel_endpoints').delete().eq('user_id', userId);
  } catch {}
}

/**
 * PWA: suscribe la URL + token del tunnel del usuario.
 * - Pull inicial + Realtime para actualizaciones.
 * - Escribe a localStorage (`setTunnelUrl` / `setAccessToken`) en cada cambio.
 *
 * Esto resuelve dos problemas:
 *  1. Quick Tunnels que cambian de URL en cada arranque del desktop.
 *  2. iOS Safari/PWA evictando localStorage tras ~7 días: el siguiente
 *     login rehidrata URL + token desde Supabase sin intervención del usuario.
 *
 * @param {string} userId
 * @param {(p:{url:string|null,token:string|null}) => void} [onChange]
 * @returns {() => void} unsubscribe
 */
export function subscribeTunnelUrl(userId, onChange) {
  if (!userId) return () => {};

  const apply = ({ url, token }) => {
    const prevUrl = getTunnelUrlSync();
    if (url && url !== prevUrl) {
      setTunnelUrl(url);
      console.info('[tunnel-registry] tunnel URL actualizada:', url);
    }
    // NUNCA borramos el tunnelUrl local desde aqui aunque Supabase
    // devuelva null. Razon: la tabla tunnel_endpoints solo la publica
    // el OWNER del desktop. Cuentas pareadas (no owner) NO tienen fila
    // propia, entonces siempre verian url=null y se les borraria su
    // tunnelUrl persistido via pareo. La eliminacion local debe ser
    // explicita (boton 'Desconectar' o 'Limpiar tunnel' en Ajustes).
    const prevTok = getAccessTokenSync();
    if (token && token !== prevTok) {
      setAccessToken(token);
      console.info('[tunnel-registry] access token rehidratado desde Supabase');
    }
    onChange?.({ url: url ?? null, token: token ?? null });
  };

  // Pull inicial — rehidrata inmediatamente URL + token al iniciar la PWA.
  supabase
    .from('tunnel_endpoints')
    .select('url, access_token')
    .eq('user_id', userId)
    .maybeSingle()
    .then(({ data }) => apply({ url: data?.url ?? null, token: data?.access_token ?? null }))
    .catch(() => {});

  // Realtime: si el desktop publica un nuevo URL o regenera el token, llega aquí.
  const channel = supabase
    .channel(`tunnel:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tunnel_endpoints', filter: `user_id=eq.${userId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') apply({ url: null, token: null });
        else apply({
          url: payload.new?.url ?? null,
          token: payload.new?.access_token ?? null,
        });
      }
    )
    .subscribe();

  return () => {
    try { supabase.removeChannel(channel); } catch {}
  };
}
