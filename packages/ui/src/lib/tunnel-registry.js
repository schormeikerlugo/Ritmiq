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
import { setTunnelUrl, getTunnelUrlSync } from './lan-client.js';

/**
 * Desktop: publica (upsert) la URL del tunnel para el usuario actual.
 * No falla si no hay sesión (silencia errores).
 * @param {string} userId
 * @param {string} url
 * @param {'quick'|'named'|'custom'} [source]
 */
export async function publishTunnelUrl(userId, url, source = 'quick') {
  if (!userId || !url) return;
  try {
    const { error } = await supabase
      .from('tunnel_endpoints')
      .upsert(
        { user_id: userId, url, source, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
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
 * PWA: suscribe la URL del tunnel del usuario.
 * - Pull inicial + Realtime para actualizaciones.
 * - Escribe a localStorage (`setTunnelUrl`) cada vez que cambia.
 * @param {string} userId
 * @param {(url:string|null) => void} [onChange]
 * @returns {() => void} unsubscribe
 */
export function subscribeTunnelUrl(userId, onChange) {
  if (!userId) return () => {};

  const apply = (url) => {
    const prev = getTunnelUrlSync();
    if (url && url !== prev) {
      setTunnelUrl(url);
      console.info('[tunnel-registry] tunnel URL actualizada:', url);
    } else if (!url && prev) {
      setTunnelUrl(null);
      console.info('[tunnel-registry] tunnel URL eliminada');
    }
    onChange?.(url ?? null);
  };

  // Pull inicial
  supabase
    .from('tunnel_endpoints')
    .select('url')
    .eq('user_id', userId)
    .maybeSingle()
    .then(({ data }) => apply(data?.url ?? null))
    .catch(() => {});

  // Realtime
  const channel = supabase
    .channel(`tunnel:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tunnel_endpoints', filter: `user_id=eq.${userId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') apply(null);
        else apply(payload.new?.url ?? null);
      }
    )
    .subscribe();

  return () => {
    try { supabase.removeChannel(channel); } catch {}
  };
}
