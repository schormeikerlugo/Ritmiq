/**
 * Cloudflare Tunnel del desktop. La lógica vive en @ritmiq/server-core
 * (host-aware); aquí solo instanciamos el singleton para el puerto del LAN
 * server desktop (3939) y re-exportamos los helpers de token/URL custom.
 *
 * @module main/cloudflared
 */
import {
  CloudflaredManager,
  getStoredToken, setStoredToken, getCustomUrl, setCustomUrl,
} from '@ritmiq/server-core/cloudflared';

export { getStoredToken, setStoredToken, getCustomUrl, setCustomUrl };

export const cloudflared = new CloudflaredManager({ port: 3939 });
