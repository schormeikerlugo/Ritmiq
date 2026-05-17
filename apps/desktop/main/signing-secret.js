/**
 * Gestion del STREAM_SIGNING_SECRET local al desktop.
 *
 * Antes este secret estaba embebido en .env.production y, por tanto, en
 * el AppImage distribuido. Si alguien obtenia el AppImage podia firmar
 * URLs falsas y bypassar la autorizacion de Supabase. En Modelo Y (cada
 * usuario con su propio desktop), cada instalacion debe tener un secret
 * unico generado al primer arranque y persistido localmente.
 *
 * Compat: durante la fase de transicion hacia device_tokens, este secret
 * sigue siendo usado por la Edge `sign-stream` para validar firmas. La
 * Edge tiene que conocerlo. Para tu propio desktop, el secret en
 * Supabase debe coincidir con el de userData/signing-secret.txt. Si no
 * coincide, las firmas no validan y se cae al modo ACCEPT_UNSIGNED.
 *
 * En Fase 4 (migracion a device_tokens) este modulo deja de usarse — el
 * desktop ya no necesita secret HMAC porque autoriza directamente con
 * device_token.
 *
 * @module main/signing-secret
 */

import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

function secretPath() {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'signing-secret.txt');
}

/**
 * Devuelve el secret persistente. Si no existe, lo genera con 32 bytes
 * random y lo guarda con permisos 0600 (solo el owner del PC puede leer).
 *
 * Override por env var `RITMIQ_STREAM_SIGNING_SECRET` para facilitar
 * deploys controlados (ej. testing donde queremos un valor conocido).
 *
 * @returns {string}
 */
export function getOrCreateSigningSecret() {
  const envOverride = process.env.RITMIQ_STREAM_SIGNING_SECRET;
  if (envOverride && envOverride.trim().length >= 32) {
    return envOverride.trim();
  }

  const p = secretPath();
  if (existsSync(p)) {
    const s = readFileSync(p, 'utf8').trim();
    if (s.length >= 32) return s;
  }
  const s = randomBytes(32).toString('hex'); // 64 chars hex
  writeFileSync(p, s, { encoding: 'utf8', mode: 0o600 });
  // Asegurar permisos si el archivo ya existia con umask default.
  try { chmodSync(p, 0o600); } catch {}
  return s;
}
