#!/usr/bin/env node
/**
 * Ritmiq Server — servicio headless 24/7 que corre el LAN server
 * (búsqueda/resolución/stream/descarga de YouTube vía yt-dlp) fuera de
 * Electron. Comparte TODA la lógica con la app desktop a través de
 * `@ritmiq/server-core`; aquí solo va el bootstrap del entorno headless.
 *
 * Arranque:
 *   RITMIQ_DATA_DIR=/var/lib/ritmiq \
 *   RITMIQ_STREAM_SIGNING_SECRET=... \
 *   node apps/server/src/index.js
 *
 * Ver apps/server/README.md para el despliegue con systemd.
 *
 * @module @ritmiq/server
 */
import { loadEnv } from './env.js';
loadEnv();

import {
  setHost, initDb, getOrCreateAccessToken, startLanServer, setSupabaseUserJwt,
} from '@ritmiq/server-core';
import { CloudflaredManager, getStoredToken } from '@ritmiq/server-core/cloudflared';
import { resolveDataDir, resolvePort } from './config.js';
import { publishServerEndpoint, clearServerEndpoint, getOwnerAccessToken } from './endpoint-registry.js';

async function main() {
  const dataDir = resolveDataDir();
  const port = resolvePort();

  // Host headless: sin safeStorage (fallback plaintext 0600), sin binarios
  // empaquetados (yt-dlp/cloudflared vienen del PATH o RITMIQ_YTDLP_PATH).
  setHost({
    dataDir,
    safeStorage: null,
    resourcesBinDir: null,
    devBinDir: null,
  });

  console.log(`[ritmiq-server] dataDir: ${dataDir}`);

  const db = initDb();
  const accessToken = getOrCreateAccessToken();

  let lan;
  try {
    lan = await startLanServer({ port, db, accessToken });
  } catch (err) {
    console.error('[ritmiq-server] el LAN server no arrancó:', err?.message ?? err);
    process.exit(1);
  }

  console.log(`[ritmiq-server] listo en el puerto ${lan.port}`);
  console.log('[ritmiq-server] access-token (Bearer del dueño):');
  console.log(`    ${accessToken}`);
  console.log('[ritmiq-server] aprueba dispositivos con: ritmiq-admin approve <device_id>,');
  console.log('    el panel web /admin, o desde la app desktop (cada cuenta gestiona los suyos).');

  // ── Sesión de dueño → JWT para el cache global de URLs ─────────────────
  // El servidor headless no tiene renderer que llame a setSupabaseUserJwt.
  // Si hay credenciales de dueño (RITMIQ_OWNER_EMAIL/PASSWORD), obtenemos su
  // JWT y lo inyectamos al lan-server para habilitar:
  //   - LEER stream_url_cache global antes de yt-dlp (Fase 2), y
  //   - PUBLICAR URLs resueltas al global (Fase 1) para toda la red Ritmiq.
  // El JWT de Supabase caduca (~1h), así que lo refrescamos periódicamente.
  let jwtTimer = null;
  const syncOwnerJwt = async () => {
    try {
      const jwt = await getOwnerAccessToken();
      if (jwt) {
        setSupabaseUserJwt(jwt);
        console.log('[ritmiq-server] JWT del dueño sincronizado (cache global URL activo)');
      }
    } catch (e) {
      console.warn('[ritmiq-server] sync JWT del dueño falló:', e?.message ?? e);
    }
  };
  await syncOwnerJwt();
  // Refrescar cada 30 min (el getOwnerAccessToken renueva si falta <2 min).
  jwtTimer = setInterval(syncOwnerJwt, 30 * 60 * 1000);
  if (jwtTimer.unref) jwtTimer.unref();

  // ── Cloudflare Tunnel + publicación del endpoint 'server' ──────────────
  // Se activa si hay token de túnel (Named) configurado, o si se fuerza el
  // Quick Tunnel con RITMIQ_TUNNEL_MODE=quick.
  const tunnelMode = String(process.env.RITMIQ_TUNNEL_MODE ?? '').toLowerCase();
  const wantTunnel = tunnelMode === 'quick' || tunnelMode === 'named' || !!getStoredToken();
  if (wantTunnel) {
    const tunnel = new CloudflaredManager({ port: lan.port });
    tunnel.onChange((st) => {
      if (st.status === 'connected' && st.url) {
        const source = /\.trycloudflare\.com$/.test(st.url) ? 'quick'
                     : /\.cfargotunnel\.com$/.test(st.url) ? 'named' : 'custom';
        console.log(`[ritmiq-server] tunnel activo: ${st.url} (${source})`);
        publishServerEndpoint(st.url, source, accessToken).catch((e) =>
          console.warn('[ritmiq-server] publish endpoint falló:', e?.message ?? e));
      } else if (st.status === 'error') {
        console.warn('[ritmiq-server] tunnel error:', st.error);
      }
    });
    tunnel.start({ mode: tunnelMode || 'auto' }).catch((e) =>
      console.warn('[ritmiq-server] tunnel start falló:', e?.message ?? e));
    lan._tunnel = tunnel;
  } else {
    console.log('[ritmiq-server] sin túnel (define RITMIQ_TUNNEL_TOKEN o RITMIQ_TUNNEL_MODE=quick para exponerlo fuera de la LAN)');
  }

  // Notificación de solicitudes de pareo (headless: log en consola). El
  // owner aprueba con la CLI `ritmiq-admin`.
  if (typeof lan.onPairRequest === 'function') {
    lan.onPairRequest((reqInfo) => {
      console.log(
        `[ritmiq-server] SOLICITUD DE PAREO: device_id=${reqInfo?.deviceId} ` +
        `nombre="${reqInfo?.displayName ?? ''}" PIN=${reqInfo?.pin ?? '?'}`
      );
      console.log('    Aprueba con: ritmiq-admin approve ' + reqInfo?.deviceId);
    });
  }

  const shutdown = async (sig) => {
    console.log(`[ritmiq-server] ${sig} — apagando…`);
    try { if (jwtTimer) clearInterval(jwtTimer); } catch {}
    try { await lan._tunnel?.stop?.(); } catch {}
    try { await clearServerEndpoint(); } catch {}
    try { await lan.stop?.(); } catch {}
    try { db.close?.(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => console.error('[ritmiq-server] uncaughtException:', err));
  process.on('unhandledRejection', (r) => console.error('[ritmiq-server] unhandledRejection:', r));
}

main();
