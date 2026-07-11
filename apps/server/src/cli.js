#!/usr/bin/env node
/**
 * ritmiq-admin — CLI de administración del servidor headless.
 *
 * Comandos:
 *   ritmiq-admin pending              Lista solicitudes de pareo pendientes.
 *   ritmiq-admin approve <device_id>  Aprueba un dispositivo (emite token).
 *   ritmiq-admin reject  <device_id>  Rechaza una solicitud pendiente.
 *   ritmiq-admin devices              Lista dispositivos pareados.
 *   ritmiq-admin revoke  <device_id>  Revoca un dispositivo aprobado.
 *   ritmiq-admin token                Muestra el access-token del dueño.
 *
 * Opera sobre la MISMA base SQLite que el servicio (RITMIQ_DATA_DIR). Se
 * puede correr mientras el servicio está activo (SQLite WAL lo permite).
 *
 * @module @ritmiq/server/cli
 */
import { loadEnv } from './env.js';
loadEnv();

import {
  setHost, initDb, getOrCreateAccessToken,
  listPairRequests, approveDevice, rejectPairRequest,
  listDevices, revokeDevice,
} from '@ritmiq/server-core';
import { resolveDataDir } from './config.js';

function usage() {
  console.log(`ritmiq-admin — administración del servidor Ritmiq

  pending              Lista solicitudes de pareo pendientes
  approve <device_id>  Aprueba un dispositivo
  reject  <device_id>  Rechaza una solicitud
  devices              Lista dispositivos pareados
  revoke  <device_id>  Revoca un dispositivo
  token                Muestra el access-token del dueño
`);
}

function fmt(rows) {
  if (!rows.length) return '  (ninguno)';
  return rows.map((r) => '  ' + JSON.stringify(r)).join('\n');
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(cmd ? 0 : 1);
  }

  setHost({ dataDir: resolveDataDir(), safeStorage: null });
  const db = initDb();

  switch (cmd) {
    case 'pending': {
      const rows = listPairRequests(db);
      console.log('Solicitudes de pareo pendientes:');
      console.log(fmt(rows));
      break;
    }
    case 'approve': {
      if (!arg) { console.error('Falta <device_id>'); process.exit(1); }
      const pending = listPairRequests(db).find((r) => r.device_id === arg);
      const token = approveDevice(db, {
        deviceId: arg,
        displayName: pending?.display_name ?? arg,
        supabaseUserId: pending?.supabase_user_id ?? null,
      });
      console.log(`Dispositivo ${arg} aprobado.`);
      console.log(`device_token: ${token}`);
      break;
    }
    case 'reject': {
      if (!arg) { console.error('Falta <device_id>'); process.exit(1); }
      rejectPairRequest(db, arg);
      console.log(`Solicitud ${arg} rechazada.`);
      break;
    }
    case 'devices': {
      console.log('Dispositivos:');
      console.log(fmt(listDevices(db)));
      break;
    }
    case 'revoke': {
      if (!arg) { console.error('Falta <device_id>'); process.exit(1); }
      revokeDevice(db, arg);
      console.log(`Dispositivo ${arg} revocado.`);
      break;
    }
    case 'token': {
      console.log(getOrCreateAccessToken());
      break;
    }
    default:
      console.error(`Comando desconocido: ${cmd}`);
      usage();
      process.exit(1);
  }

  db.close?.();
}

main();
