/**
 * Cliente HTTP de administración de dispositivos contra el SERVIDOR 24/7
 * (endpoints /devices/* con auth por cuenta). Lo usa `DevicesSection` cuando
 * el desktop administra un servidor remoto (no su propio lan-server local).
 *
 * Autenticación (en orden de preferencia):
 *   1. Server token del owner (getServerTokenSync) → administra TODO.
 *   2. JWT de la sesión Supabase                    → sub-admin: solo lo suyo.
 *
 * @module @ritmiq/ui/lib/remote-admin
 */
import { supabase } from './supabase.js';
import { getServerUrlSync, getServerTokenSync } from './lan-client.js';

/** ¿Hay un servidor remoto configurado para administrar? */
export function hasRemoteServer() {
  return Boolean(getServerUrlSync());
}

/** Resuelve el Bearer a usar: server-token (owner) o JWT de Supabase. */
async function resolveBearer() {
  const ownerToken = getServerTokenSync();
  if (ownerToken) return ownerToken;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function req(path, { method = 'GET', body } = {}) {
  const base = getServerUrlSync();
  if (!base) throw new Error('no_remote_server');
  const bearer = await resolveBearer();
  if (!bearer) throw new Error('no_auth');
  const res = await fetch(base.replace(/\/+$/, '') + path, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (res.status === 403) throw new Error('forbidden');
  if (!res.ok) throw new Error(`http_${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/** { owner, userId, devices[], pending[] } */
export function remoteState() {
  return req('/devices/mine');
}

export function remoteApprove(deviceId) {
  return req('/devices/approve', { method: 'POST', body: { device_id: deviceId } });
}
export function remoteReject(deviceId) {
  return req('/devices/reject', { method: 'POST', body: { device_id: deviceId } });
}
export function remoteRevoke(deviceId) {
  return req('/devices/revoke', { method: 'POST', body: { device_id: deviceId } });
}
export function remoteRename(deviceId, name) {
  return req('/devices/rename', { method: 'POST', body: { device_id: deviceId, name } });
}
/** Aporta cookies (Netscape en base64) a un device del servidor remoto. */
export function remoteSetCookies(deviceId, cookiesB64) {
  return req('/devices/cookies', {
    method: 'POST',
    body: { device_id: deviceId, cookies_b64: cookiesB64 },
  });
}
