/**
 * Tests para el modulo de devices (Modelo Y).
 *
 * Ejecutar:
 *   cd apps/desktop && node --test main/devices.test.js
 *
 * Cubre los flujos criticos: createPairRequest, approveDevice,
 * rejectPairRequest, revokeDevice, listDevices, getPairStatus,
 * findDeviceByToken, logActivity + pruneOldActivity, expiracion de
 * pair_requests, y rate-limit semantica via createPairRequest idempotente.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

import { SCHEMA_SQL } from '../../../packages/db/src/schema.js';
import {
  createPairRequest, approveDevice, rejectPairRequest,
  revokeDevice, renameDevice, getPairStatus,
  findDeviceByToken, listDevices, listPairRequests,
  logActivity, getDeviceActivity, pruneOldActivity,
  updateDeviceCookies, deriveDisplayNameFromUA, newDeviceId,
} from './devices.js';

// better-sqlite3 esta compilado para Electron via electron-rebuild en
// arranque del AppImage. Para tests en node plano necesita estar
// compilado contra ABI de node. Si no carga, saltamos los tests
// DB-dependientes (las pruebas puras de helpers igual corren).
let Database = null;
let dbAvailable = true;
try {
  Database = (await import('better-sqlite3')).default;
  // Probar que el binding nativo carga (no solo el wrapper JS).
  const probe = new Database(':memory:');
  probe.close();
} catch (err) {
  dbAvailable = false;
  console.warn('[devices.test] better-sqlite3 no disponible — DB tests skipped.');
  console.warn('  Es esperable si node esta compilado contra una ABI distinta a la del binding.');
  console.warn('  El binding actual fue compilado para Electron (electron-rebuild).');
  console.warn('  Para correr DB tests: pnpm rebuild better-sqlite3 (re-compila para el node host).');
  console.warn('  Despues hay que correr electron-rebuild antes del build de produccion.');
}

/** @type {string} */ let tmpDir;
/** @type {any} */ let db;

beforeEach(() => {
  if (!dbAvailable) return;
  tmpDir = mkdtempSync(join(tmpdir(), 'ritmiq-test-'));
  db = new Database(join(tmpDir, 'test.sqlite'));
  db.exec(SCHEMA_SQL);
});

afterEach(() => {
  if (!dbAvailable) return;
  try { db?.close(); } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

/** Wrapper: skip si DB no disponible. */
const dbTest = (name, fn) => test(name, { skip: !dbAvailable ? 'better-sqlite3 unavailable' : false }, fn);

describe('createPairRequest', () => {
  dbTest('crea pair_request con status pending', () => {
    const out = createPairRequest(db, {
      deviceId: 'dev-1',
      displayName: 'iPhone Ana',
      pin: '1234',
    });
    assert.equal(out.status, 'pending');
    const pending = listPairRequests(db);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].device_id, 'dev-1');
    assert.equal(pending[0].pin, '1234');
  });

  dbTest('idempotente: device ya aprobado devuelve token existente', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1111' });
    const token = approveDevice(db, { deviceId: 'dev-1', displayName: 'iPhone' });
    // Re-pair con mismo device_id
    const out = createPairRequest(db, {
      deviceId: 'dev-1', displayName: 'iPhone', pin: '2222',
    });
    assert.equal(out.status, 'approved');
    assert.equal(out.deviceToken, token);
  });

  dbTest('NO auto-aprueba aunque exista sibling con mismo supabase_user_id (PIN siempre)', () => {
    // Aprobamos un device de Ana
    createPairRequest(db, {
      deviceId: 'iphone-ana',
      displayName: 'iPhone',
      supabaseUserId: 'user-ana',
      pin: '1111',
    });
    approveDevice(db, {
      deviceId: 'iphone-ana',
      displayName: 'iPhone',
      supabaseUserId: 'user-ana',
    });
    // Ana intenta pair su iPad con misma supabase_user_id
    const out = createPairRequest(db, {
      deviceId: 'ipad-ana',
      displayName: 'iPad',
      supabaseUserId: 'user-ana',
      pin: '2222',
    });
    assert.equal(out.status, 'pending', 'auto-pair debe estar DESACTIVADO');
    assert.equal(out.deviceToken, undefined);
  });

  dbTest('lanza si faltan campos obligatorios', () => {
    assert.throws(() => createPairRequest(db, { deviceId: '', displayName: 'x', pin: '1' }));
    assert.throws(() => createPairRequest(db, { deviceId: 'd', displayName: '', pin: '1' }));
    assert.throws(() => createPairRequest(db, { deviceId: 'd', displayName: 'x', pin: '' }));
  });
});

describe('approveDevice', () => {
  dbTest('mueve pair_request a devices y emite token unico', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1234' });
    const token = approveDevice(db, { deviceId: 'dev-1', displayName: 'iPhone' });
    assert.ok(token);
    assert.equal(token.length >= 32, true);
    const devices = listDevices(db);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].device_id, 'dev-1');
    assert.equal(devices[0].device_token, token);
    assert.equal(devices[0].status, 'approved');
    // pair_request debe haberse borrado
    const pending = listPairRequests(db);
    assert.equal(pending.length, 0);
  });

  dbTest('persiste supabase_user_id y cookies_blob', () => {
    const cookies = Buffer.from('# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t9999999999\tSID\tabc', 'utf8');
    createPairRequest(db, {
      deviceId: 'dev-1',
      displayName: 'iPhone',
      supabaseUserId: 'user-ana',
      cookiesBlob: cookies,
      pin: '1234',
    });
    approveDevice(db, {
      deviceId: 'dev-1',
      displayName: 'iPhone',
      supabaseUserId: 'user-ana',
      cookiesBlob: cookies,
    });
    const row = listDevices(db)[0];
    assert.equal(row.supabase_user_id, 'user-ana');
    assert.ok(row.cookies_updated_at);
  });
});

describe('findDeviceByToken', () => {
  dbTest('devuelve fila si token aprobado', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1234' });
    const token = approveDevice(db, { deviceId: 'dev-1', displayName: 'iPhone' });
    const found = findDeviceByToken(db, token);
    assert.ok(found);
    assert.equal(found.device_id, 'dev-1');
  });

  dbTest('devuelve null si token no existe', () => {
    assert.equal(findDeviceByToken(db, 'token-falso'), undefined);
  });

  dbTest('devuelve null si device fue revocado', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1234' });
    const token = approveDevice(db, { deviceId: 'dev-1', displayName: 'iPhone' });
    revokeDevice(db, 'dev-1');
    const found = findDeviceByToken(db, token);
    assert.equal(found, undefined);
  });

  dbTest('actualiza last_seen_at', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1234' });
    const token = approveDevice(db, { deviceId: 'dev-1', displayName: 'iPhone' });
    assert.equal(listDevices(db)[0].last_seen_at, null);
    findDeviceByToken(db, token);
    const row = listDevices(db)[0];
    assert.ok(row.last_seen_at);
  });
});

describe('rejectPairRequest', () => {
  dbTest('borra pair_request', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1234' });
    assert.equal(listPairRequests(db).length, 1);
    rejectPairRequest(db, 'dev-1');
    assert.equal(listPairRequests(db).length, 0);
  });
});

describe('renameDevice', () => {
  dbTest('actualiza display_name', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1234' });
    approveDevice(db, { deviceId: 'dev-1', displayName: 'iPhone' });
    renameDevice(db, 'dev-1', 'iPhone de Ana');
    assert.equal(listDevices(db)[0].display_name, 'iPhone de Ana');
  });
});

describe('getPairStatus', () => {
  dbTest('approved cuando ya esta en devices', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1234' });
    const token = approveDevice(db, { deviceId: 'dev-1', displayName: 'iPhone' });
    const st = getPairStatus(db, 'dev-1');
    assert.equal(st.status, 'approved');
    assert.equal(st.deviceToken, token);
  });

  dbTest('pending cuando esta en pair_requests vigente', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1234' });
    const st = getPairStatus(db, 'dev-1');
    assert.equal(st.status, 'pending');
  });

  dbTest('rejected cuando no esta en ninguna tabla', () => {
    const st = getPairStatus(db, 'dev-fantasma');
    assert.equal(st.status, 'rejected');
  });

  dbTest('expired cuando pair_request paso su TTL', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1234' });
    // Forzamos expires_at al pasado
    db.prepare("UPDATE pair_requests SET expires_at = ? WHERE device_id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), 'dev-1');
    const st = getPairStatus(db, 'dev-1');
    assert.equal(st.status, 'rejected'); // expired = rejected en getPairStatus
  });
});

describe('logActivity + pruneOldActivity', () => {
  dbTest('inserta y lee eventos', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1234' });
    approveDevice(db, { deviceId: 'dev-1', displayName: 'iPhone' });
    logActivity(db, { deviceId: 'dev-1', action: 'stream', ytId: 'abc123' });
    logActivity(db, { deviceId: 'dev-1', action: 'download', trackId: 't-1', ytId: 'def456' });
    const log = getDeviceActivity(db, 'dev-1', 10);
    assert.equal(log.length, 2);
    // Mas reciente primero
    assert.equal(log[0].action, 'download');
    assert.equal(log[1].action, 'stream');
  });

  dbTest('pruneOldActivity borra eventos mas viejos que N dias', () => {
    logActivity(db, { deviceId: 'dev-1', action: 'stream', ytId: 'abc' });
    // Forzamos created_at antiguo
    db.prepare("UPDATE device_activity SET created_at = ? WHERE device_id = ?")
      .run(new Date(Date.now() - 10 * 86400 * 1000).toISOString(), 'dev-1');
    logActivity(db, { deviceId: 'dev-1', action: 'stream', ytId: 'fresh' });
    pruneOldActivity(db, 5);
    const log = getDeviceActivity(db, 'dev-1', 10);
    assert.equal(log.length, 1);
    assert.equal(log[0].yt_id, 'fresh');
  });
});

describe('updateDeviceCookies', () => {
  dbTest('actualiza blob + timestamp', () => {
    createPairRequest(db, { deviceId: 'dev-1', displayName: 'iPhone', pin: '1234' });
    approveDevice(db, { deviceId: 'dev-1', displayName: 'iPhone' });
    const before = listDevices(db)[0].cookies_updated_at;
    updateDeviceCookies(db, 'dev-1', Buffer.from('cookies content', 'utf8'));
    const after = listDevices(db)[0].cookies_updated_at;
    assert.ok(after);
    assert.notEqual(before, after);
  });
});

describe('helpers', () => {
  test('newDeviceId genera UUID v4 valido', () => {
    const id = newDeviceId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('deriveDisplayNameFromUA detecta iPhone/iPad/Android', () => {
    assert.equal(deriveDisplayNameFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), 'iPhone');
    assert.equal(deriveDisplayNameFromUA('Mozilla/5.0 (iPad; CPU OS 17_0)'), 'iPad');
    assert.equal(deriveDisplayNameFromUA('Mozilla/5.0 (Linux; Android 14)'), 'Android');
    assert.equal(deriveDisplayNameFromUA('Mozilla/5.0 (Windows NT 10.0)'), 'Windows');
    assert.equal(deriveDisplayNameFromUA('Mozilla/5.0 (Macintosh; Intel Mac OS X)'), 'Mac');
    assert.equal(deriveDisplayNameFromUA(''), 'Dispositivo');
  });
});
