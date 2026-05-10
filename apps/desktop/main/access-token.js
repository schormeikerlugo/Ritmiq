/**
 * Token de acceso (Bearer) para autenticar clientes externos contra el
 * LAN server. Se genera la primera vez y se persiste en userData.
 *
 * El usuario lo copia y lo pega en la PWA → Settings → "Token de acceso".
 *
 * @module main/access-token
 */

import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

function tokenPath() {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'access-token.txt');
}

/** @returns {string} */
export function getOrCreateAccessToken() {
  const p = tokenPath();
  if (existsSync(p)) {
    const t = readFileSync(p, 'utf8').trim();
    if (t) return t;
  }
  // 32 bytes en base64url → 43 chars sin padding.
  const t = randomBytes(32).toString('base64url');
  writeFileSync(p, t, 'utf8');
  return t;
}

/** Regenera y persiste un nuevo token. */
export function regenerateAccessToken() {
  const t = randomBytes(32).toString('base64url');
  writeFileSync(tokenPath(), t, 'utf8');
  return t;
}
