/**
 * Registry de endpoints — publicación/suscripción de las URLs públicas de
 * los servidores del usuario a través de Supabase (tabla `tunnel_endpoints`).
 *
 * Multi-endpoint (Fase 2): un usuario puede tener DOS endpoints a la vez:
 *   - kind='desktop' → la app desktop (rápida, intermitente).
 *   - kind='server'  → el servidor casero headless 24/7 (siempre on).
 *
 * - El desktop publica su fila (kind='desktop').
 * - El servidor publica la suya (kind='server') desde apps/server.
 * - La PWA observa AMBAS filas (Realtime + pull) y las guarda en localStorage
 *   (`ritmiq:lan:tunnelUrl` para desktop, `ritmiq:lan:serverUrl` para server),
 *   para que el selector de conexión elija según `serverMode`.
 *
 * @module @ritmiq/ui/lib/tunnel-registry
 */
import { supabase } from './supabase.js';
import {
  setTunnelUrl, getTunnelUrlSync,
  setServerUrl, getServerUrlSync, setServerToken,
  setAccessToken, getAccessTokenSync,
} from './lan-client.js';

/**
 * Publica (upsert) un endpoint del usuario.
 * @param {string} userId
 * @param {string} url
 * @param {'quick'|'named'|'custom'} [source]
 * @param {string|null} [accessToken]
 * @param {'desktop'|'server'} [kind]
 */
export async function publishTunnelUrl(userId, url, source = 'quick', accessToken = null, kind = 'desktop') {
  if (!userId || !url) return;
  try {
    const payload = {
      user_id: userId,
      kind,
      url,
      source,
      updated_at: new Date().toISOString(),
    };
    if (accessToken) payload.access_token = accessToken;
    const { error } = await supabase
      .from('tunnel_endpoints')
      .upsert(payload, { onConflict: 'user_id,kind' });
    if (error) console.warn('[tunnel-registry] publish:', error.message);
  } catch (e) {
    console.warn('[tunnel-registry] publish failed:', e?.message ?? e);
  }
}

/**
 * Borra un endpoint del usuario.
 * @param {string} userId
 * @param {'desktop'|'server'} [kind]
 */
export async function clearTunnelUrl(userId, kind = 'desktop') {
  if (!userId) return;
  try {
    await supabase.from('tunnel_endpoints')
      .delete()
      .eq('user_id', userId)
      .eq('kind', kind);
  } catch {}
}

/**
 * PWA: suscribe TODOS los endpoints del usuario (desktop + server).
 *  - Pull inicial + Realtime para actualizaciones.
 *  - Escribe a localStorage según el kind de cada fila.
 *
 * @param {string} userId
 * @param {(p:{ desktopUrl:string|null, serverUrl:string|null }) => void} [onChange]
 * @returns {() => void} unsubscribe
 */
export function subscribeTunnelUrl(userId, onChange) {
  if (!userId) return () => {};

  /** Aplica una fila (o su borrado) al localStorage correspondiente. */
  const applyRow = (kind, url, token) => {
    if (kind === 'server') {
      if (url && url !== getServerUrlSync()) {
        setServerUrl(url);
        console.info('[tunnel-registry] server URL actualizada:', url);
      }
      if (token) setServerToken(token);
    } else {
      // desktop
      if (url && url !== getTunnelUrlSync()) {
        setTunnelUrl(url);
        console.info('[tunnel-registry] desktop tunnel URL actualizada:', url);
      }
      // El token del desktop se guarda como accessToken legacy (compat).
      const prevTok = getAccessTokenSync();
      if (token && token !== prevTok) {
        setAccessToken(token);
        console.info('[tunnel-registry] access token rehidratado desde Supabase');
      }
    }
    // NUNCA borramos URLs locales aunque Supabase devuelva null: cuentas
    // pareadas (no owner) no tienen fila propia. La eliminación es explícita.
    onChange?.({ desktopUrl: getTunnelUrlSync(), serverUrl: getServerUrlSync() });
  };

  // Pull inicial — rehidrata ambos endpoints.
  supabase
    .from('tunnel_endpoints')
    .select('kind, url, access_token')
    .eq('user_id', userId)
    .then(({ data }) => {
      for (const row of data ?? []) {
        applyRow(row.kind ?? 'desktop', row.url ?? null, row.access_token ?? null);
      }
    })
    .catch(() => {});

  // Realtime: nuevas URLs / tokens de cualquiera de los endpoints.
  const channel = supabase
    .channel(`tunnel:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tunnel_endpoints', filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
        const kind = row?.kind ?? 'desktop';
        if (payload.eventType === 'DELETE') {
          // No borramos localStorage automáticamente (ver nota arriba).
          onChange?.({ desktopUrl: getTunnelUrlSync(), serverUrl: getServerUrlSync() });
          return;
        }
        applyRow(kind, row?.url ?? null, row?.access_token ?? null);
      }
    )
    .subscribe();

  return () => {
    try { supabase.removeChannel(channel); } catch {}
  };
}
