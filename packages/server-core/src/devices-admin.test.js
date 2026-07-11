/**
 * Tests de administración por cuenta: listados filtrados por supabase_user_id
 * y verificación de pertenencia. Base del modelo sub-admin (Fase 4b).
 *   node --test packages/server-core/src/devices-admin.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '@ritmiq/db/sqlite';
import {
  createPairRequest, approveDevice,
  listDevicesForUser, listPairRequestsForUser, getDeviceOwnerUserId,
} from './devices.js';

function freshDb() {
  const db = new Database(':memory:');
  applySchema(db);
  return db;
}

test('listPairRequestsForUser filtra por cuenta', () => {
  const db = freshDb();
  createPairRequest(db, { deviceId: 'd-a', displayName: 'A', supabaseUserId: 'user-1', pin: '1111' });
  createPairRequest(db, { deviceId: 'd-b', displayName: 'B', supabaseUserId: 'user-2', pin: '2222' });
  const u1 = listPairRequestsForUser(db, 'user-1');
  assert.equal(u1.length, 1);
  assert.equal(u1[0].device_id, 'd-a');
  assert.equal(listPairRequestsForUser(db, 'user-2').length, 1);
  assert.equal(listPairRequestsForUser(db, 'user-3').length, 0);
  assert.equal(listPairRequestsForUser(db, null).length, 0);
});

test('listDevicesForUser filtra dispositivos aprobados por cuenta', () => {
  const db = freshDb();
  createPairRequest(db, { deviceId: 'd-a', displayName: 'A', supabaseUserId: 'user-1', pin: '1111' });
  createPairRequest(db, { deviceId: 'd-b', displayName: 'B', supabaseUserId: 'user-2', pin: '2222' });
  approveDevice(db, { deviceId: 'd-a', displayName: 'A', supabaseUserId: 'user-1' });
  approveDevice(db, { deviceId: 'd-b', displayName: 'B', supabaseUserId: 'user-2' });
  const u1 = listDevicesForUser(db, 'user-1');
  assert.equal(u1.length, 1);
  assert.equal(u1[0].device_id, 'd-a');
  assert.equal(u1[0].supabase_user_id, 'user-1');
});

test('getDeviceOwnerUserId resuelve desde devices y pair_requests', () => {
  const db = freshDb();
  createPairRequest(db, { deviceId: 'pend', displayName: 'P', supabaseUserId: 'user-x', pin: '9999' });
  // Aún pendiente: debe salir de pair_requests.
  assert.equal(getDeviceOwnerUserId(db, 'pend'), 'user-x');
  approveDevice(db, { deviceId: 'appr', displayName: 'Ok', supabaseUserId: 'user-y' });
  // Aprobado: debe salir de devices.
  assert.equal(getDeviceOwnerUserId(db, 'appr'), 'user-y');
  // Inexistente.
  assert.equal(getDeviceOwnerUserId(db, 'nope'), null);
});

test('pertenencia: un usuario no debe coincidir con device de otra cuenta', () => {
  const db = freshDb();
  approveDevice(db, { deviceId: 'd-other', displayName: 'Otro', supabaseUserId: 'owner-A' });
  const ownerId = getDeviceOwnerUserId(db, 'd-other');
  // Simula el guard del endpoint: sub-admin 'attacker' intenta gestionar d-other.
  const attacker = 'attacker-B';
  assert.notEqual(ownerId, attacker); // → el endpoint devolvería 403
});
