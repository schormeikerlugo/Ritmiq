/**
 * Token de acceso (Bearer) para autenticar clientes externos contra el
 * LAN server. Se genera la primera vez y se persiste en userData.
 *
 * El usuario lo copia y lo pega en la PWA → Settings → "Token de acceso".
 *
 * @module main/access-token
 */

import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

function tokenPath() {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'access-token.txt');
}

/**
 * Asegura permisos 0600 (rw solo para owner del PC) en archivos sensibles.
 * Sin esto, en sistemas multiusuario otros usuarios del PC podrian leer
 * el token via /home/.../access-token.txt — y con el token autenticarse
 * contra el LAN server desde la red local.
 *
 * @param {string} p
 */
function secureFile(p) {
  try { chmodSync(p, 0o600); } catch {}
}

/** @returns {string} */
export function getOrCreateAccessToken() {
  const p = tokenPath();
  if (existsSync(p)) {
    secureFile(p); // por si el archivo viene de una version anterior con 0644
    const t = readFileSync(p, 'utf8').trim();
    if (t) return t;
  }
  // 32 bytes en base64url → 43 chars sin padding.
  const t = randomBytes(32).toString('base64url');
  writeFileSync(p, t, { encoding: 'utf8', mode: 0o600 });
  secureFile(p);
  return t;
}

/** Regenera y persiste un nuevo token. */
export function regenerateAccessToken() {
  const t = randomBytes(32).toString('base64url');
  const p = tokenPath();
  writeFileSync(p, t, { encoding: 'utf8', mode: 0o600 });
  secureFile(p);
  return t;
}
