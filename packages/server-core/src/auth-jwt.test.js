/**
 * Tests de verificación de JWT (ES256 vía JWKS y HS256 legacy).
 * Ejecuta con: node --test packages/server-core/src/auth-jwt.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createJwtVerifier } from './auth-jwt.js';

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Firma un JWT HS256. */
function signHs256(payload, secret, header = {}) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', ...header }));
  const p = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64url(sig)}`;
}

/** Firma un JWT ES256 (P-256), devuelve token + JWK público. */
function signEs256(payload, kid = 'test-kid', header = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const h = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid, ...header }));
  const p = b64url(JSON.stringify(payload));
  const der = crypto.sign('sha256', Buffer.from(`${h}.${p}`), {
    key: privateKey,
    dsaEncoding: 'der',
  });
  // DER → raw (r||s) que espera JOSE.
  const raw = derToRaw(der, 32);
  const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'ES256', use: 'sig', kid };
  return { token: `${h}.${p}.${b64url(raw)}`, jwk };
}

function derToRaw(der, size) {
  // Parse mínimo de la secuencia DER de ECDSA.
  let offset = 2; // 0x30 len
  if (der[1] & 0x80) offset += der[1] & 0x7f;
  const readInt = () => {
    offset++; // 0x02
    let len = der[offset++];
    let val = der.subarray(offset, offset + len);
    offset += len;
    while (val.length > size) val = val.subarray(1);
    return Buffer.concat([Buffer.alloc(size - val.length), val]);
  };
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

const AUD = 'authenticated';
const ISS = 'https://proj.supabase.co/auth/v1';
const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 10;

test('HS256: token válido devuelve userId', async () => {
  const secret = 'super-secret';
  const v = createJwtVerifier({ hs256Secret: secret, supabaseUrl: 'https://proj.supabase.co' });
  const token = signHs256({ sub: 'user-123', email: 'a@b.c', aud: AUD, iss: ISS, exp: future }, secret);
  const r = await v.verify(token);
  assert.equal(r?.userId, 'user-123');
  assert.equal(r?.email, 'a@b.c');
});

test('HS256: firma inválida → null', async () => {
  const v = createJwtVerifier({ hs256Secret: 'right', supabaseUrl: 'https://proj.supabase.co' });
  const token = signHs256({ sub: 'x', aud: AUD, iss: ISS, exp: future }, 'wrong');
  assert.equal(await v.verify(token), null);
});

test('token expirado → null', async () => {
  const secret = 's';
  const v = createJwtVerifier({ hs256Secret: secret, supabaseUrl: 'https://proj.supabase.co' });
  const token = signHs256({ sub: 'x', aud: AUD, iss: ISS, exp: past }, secret);
  assert.equal(await v.verify(token), null);
});

test('audiencia incorrecta → null', async () => {
  const secret = 's';
  const v = createJwtVerifier({ hs256Secret: secret, supabaseUrl: 'https://proj.supabase.co' });
  const token = signHs256({ sub: 'x', aud: 'anon', iss: ISS, exp: future }, secret);
  assert.equal(await v.verify(token), null);
});

test('ES256: token válido verificado contra JWKS', async () => {
  const { token, jwk } = signEs256({ sub: 'user-es', aud: AUD, iss: ISS, exp: future });
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwk] }) });
  const v = createJwtVerifier({ supabaseUrl: 'https://proj.supabase.co', fetchImpl: fakeFetch });
  const r = await v.verify(token);
  assert.equal(r?.userId, 'user-es');
});

test('ES256: token manipulado (payload alterado) → null', async () => {
  const { token, jwk } = signEs256({ sub: 'user-es', aud: AUD, iss: ISS, exp: future });
  const parts = token.split('.');
  const tampered = b64url(JSON.stringify({ sub: 'attacker', aud: AUD, iss: ISS, exp: future }));
  const bad = `${parts[0]}.${tampered}.${parts[2]}`;
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwk] }) });
  const v = createJwtVerifier({ supabaseUrl: 'https://proj.supabase.co', fetchImpl: fakeFetch });
  assert.equal(await v.verify(bad), null);
});

test('token malformado → null', async () => {
  const v = createJwtVerifier({ hs256Secret: 's' });
  assert.equal(await v.verify('no-un-jwt'), null);
  assert.equal(await v.verify(''), null);
  assert.equal(await v.verify(null), null);
});

test('isConfigured refleja si hay JWKS o secret', () => {
  assert.equal(createJwtVerifier({}).isConfigured(), false);
  assert.equal(createJwtVerifier({ hs256Secret: 's' }).isConfigured(), true);
  assert.equal(createJwtVerifier({ supabaseUrl: 'https://x.supabase.co' }).isConfigured(), true);
});
