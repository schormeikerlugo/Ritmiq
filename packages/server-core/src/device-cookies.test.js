/**
 * Tests del cifrado de cookies (device-cookies.js).
 *   node --test packages/server-core/src/device-cookies.test.js
 *
 * Cubre el round-trip en los esquemas headless: plain y AES-GCM.
 * safeStorage (Electron) no se prueba aquí (requiere Electron).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAMPLE = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tABC123\n';

async function freshModule() {
  // Import con cache-busting para releer el estado del host por test.
  const host = await import('./host.js');
  host.setHost({ dataDir: mkdtempSync(join(tmpdir(), 'ritmiq-dc-')), safeStorage: null });
  return import('./device-cookies.js');
}

test('plain: round-trip cuando no hay key ni safeStorage', async () => {
  delete process.env.RITMIQ_COOKIES_KEY;
  const { encryptCookies, decryptCookies } = await freshModule();
  const blob = encryptCookies(SAMPLE);
  // Debe llevar el prefijo plain: y NO ser texto claro sin marcar.
  assert.equal(blob.slice(0, 6).toString('utf8'), 'plain:');
  assert.equal(decryptCookies(blob), SAMPLE);
});

test('AES-GCM round-trip con RITMIQ_COOKIES_KEY', async () => {
  process.env.RITMIQ_COOKIES_KEY = 'clave-secreta-de-prueba';
  const { encryptCookies, decryptCookies } = await freshModule();
  const blob = encryptCookies(SAMPLE);
  assert.equal(blob.slice(0, 6).toString('utf8'), 'agcm1:');
  // El ciphertext NO debe contener el texto plano.
  assert.ok(!blob.toString('utf8').includes('SID\tABC123'));
  assert.equal(decryptCookies(blob), SAMPLE);
});

test('AES-GCM falla a null si la key cambia', async () => {
  process.env.RITMIQ_COOKIES_KEY = 'key-original';
  const { encryptCookies } = await freshModule();
  const blob = encryptCookies(SAMPLE);
  process.env.RITMIQ_COOKIES_KEY = 'key-distinta';
  const { decryptCookies } = await freshModule();
  assert.equal(decryptCookies(blob), null);
});

test('blob vacío / null → null', async () => {
  delete process.env.RITMIQ_COOKIES_KEY;
  const { encryptCookies, decryptCookies } = await freshModule();
  assert.equal(decryptCookies(null), null);
  assert.equal(decryptCookies(Buffer.alloc(0)), null);
  assert.equal(encryptCookies('').length, 0);
});
