/**
 * Gestion de devices pareados al desktop.
 *
 * Modelo Y (decision arquitectonica del 17/05):
 *   - Cada desktop autoriza por si mismo: no depende de Supabase RLS
 *     para decidir quien puede reproducir.
 *   - Cada device (PWA en iPhone/iPad/PC) se parea explicitamente con
 *     este desktop una vez; recibe un device_token unico y lo persiste.
 *   - Auto-pairing por cuenta Supabase: si Ana parea su iPhone, su iPad
 *     con la misma cuenta Supabase se aprueba sin PIN.
 *
 * Flujo:
 *   1. PWA: POST /pair { device_id, display_name, supabase_user_id?,
 *      pin, cookies_b64? }
 *      - Si supabase_user_id coincide con algun device approved en este
 *        desktop -> auto-aprobacion, emite device_token directamente.
 *      - Si no -> crea pair_request con PIN, espera aprobacion manual.
 *   2. PWA: GET /pair/status?device_id=X -> { status, device_token? }
 *      Polling cada 2-3s mientras esta en la pantalla "esperando".
 *   3. Owner desktop: UI lista pair_requests pendientes, compara PIN
 *      visualmente con el que muestra la PWA, click approve.
 *   4. Approve mueve pair_request -> devices, emite device_token random.
 *
 * @module main/devices
 */

import { randomBytes, randomUUID } from 'node:crypto';

/**
 * @typedef {Object} DeviceRow
 * @property {string} device_id
 * @property {string} device_token
 * @property {string} display_name
 * @property {string|null} supabase_user_id
 * @property {'approved'|'revoked'} status
 * @property {string} approved_at
 * @property {string|null} last_seen_at
 * @property {string|null} revoked_at
 * @property {string|null} cookies_updated_at
 */

const PAIR_REQUEST_TTL_MS = 10 * 60 * 1000; // 10 min
const DEVICE_TOKEN_BYTES = 32;

/**
 * Crea o resucita una solicitud de pareo.
 *
 * Si ya hay device approved con el mismo (device_id) -> retorna el
 * device_token existente (idempotente — util si la PWA pierde su token
 * pero conserva su device_id).
 *
 * Si supabase_user_id matchea un device approved en este desktop
 * (auto-pair per cuenta), aprueba el nuevo device inmediatamente.
 *
 * Si no, crea pair_request y devuelve el PIN.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Object} input
 * @param {string} input.deviceId
 * @param {string} input.displayName
 * @param {string|null} [input.supabaseUserId]
 * @param {string} input.pin
 * @param {Buffer|null} [input.cookiesBlob]
 * @param {string|null} [input.clientIp]
 * @returns {{ status: 'approved'|'pending', deviceToken?: string, displayName: string }}
 */
export function createPairRequest(db, {
  deviceId, displayName, supabaseUserId = null, pin,
  cookiesBlob = null, clientIp = null,
}) {
  if (!deviceId || !displayName || !pin) {
    throw new Error('deviceId, displayName, pin required');
  }

  // Idempotencia: device ya aprobado -> devolver token existente.
  const existing = db.prepare(
    "SELECT device_token, display_name FROM devices WHERE device_id = ? AND status = 'approved'"
  ).get(deviceId);
  if (existing) {
    return {
      status: 'approved',
      deviceToken: existing.device_token,
      displayName: existing.display_name,
    };
  }

  // DECISION (Sun May 17 2026): auto-pair per cuenta Supabase DESACTIVADO.
  // El owner debe aprobar cada device manualmente con PIN. Compromiso
  // de cuenta Supabase != compromiso de devices. Si en el futuro se
  // reactiva auto-pair, el bloque se restaura con un check de feature
  // flag en el config del desktop.

  // Crear/actualizar pair_request con TTL.
  const now = Date.now();
  db.prepare(/* sql */ `
    INSERT INTO pair_requests
      (device_id, display_name, supabase_user_id, pin, cookies_blob,
       requested_at, expires_at, client_ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      display_name = excluded.display_name,
      supabase_user_id = excluded.supabase_user_id,
      pin = excluded.pin,
      cookies_blob = excluded.cookies_blob,
      requested_at = excluded.requested_at,
      expires_at = excluded.expires_at,
      client_ip = excluded.client_ip
  `).run(
    deviceId, displayName, supabaseUserId, pin, cookiesBlob,
    new Date(now).toISOString(),
    new Date(now + PAIR_REQUEST_TTL_MS).toISOString(),
    clientIp,
  );

  return { status: 'pending', displayName };
}

/**
 * Aprueba un device. Si proviene de un pair_request, mueve los datos.
 * Si se llama directo (auto-pair), inserta inmediatamente.
 *
 * Genera device_token random.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Object} input
 * @param {string} input.deviceId
 * @param {string} input.displayName
 * @param {string|null} [input.supabaseUserId]
 * @param {Buffer|null} [input.cookiesBlob]
 * @returns {string} device_token
 */
export function approveDevice(db, {
  deviceId, displayName, supabaseUserId = null, cookiesBlob = null,
}) {
  const token = randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    // Si hay pair_request con cookies y no nos pasaron explicitas, usarlas.
    const pr = db.prepare(
      'SELECT cookies_blob FROM pair_requests WHERE device_id = ?'
    ).get(deviceId);
    const finalCookies = cookiesBlob ?? pr?.cookies_blob ?? null;

    db.prepare(/* sql */ `
      INSERT INTO devices
        (device_id, device_token, display_name, supabase_user_id,
         status, cookies_blob, cookies_updated_at, approved_at, last_seen_at)
      VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, NULL)
      ON CONFLICT(device_id) DO UPDATE SET
        device_token = excluded.device_token,
        display_name = excluded.display_name,
        supabase_user_id = excluded.supabase_user_id,
        status = 'approved',
        cookies_blob = COALESCE(excluded.cookies_blob, devices.cookies_blob),
        cookies_updated_at = CASE
          WHEN excluded.cookies_blob IS NOT NULL THEN excluded.cookies_updated_at
          ELSE devices.cookies_updated_at END,
        approved_at = excluded.approved_at,
        revoked_at = NULL
    `).run(
      deviceId, token, displayName, supabaseUserId,
      finalCookies,
      finalCookies ? now : null,
      now,
    );
    db.prepare('DELETE FROM pair_requests WHERE device_id = ?').run(deviceId);
  });
  tx();
  return token;
}

/**
 * Rechaza una solicitud pendiente. Solo afecta a pair_requests.
 * @param {import('better-sqlite3').Database} db
 * @param {string} deviceId
 */
export function rejectPairRequest(db, deviceId) {
  db.prepare('DELETE FROM pair_requests WHERE device_id = ?').run(deviceId);
}

/**
 * Revoca un device aprobado. El device_token deja de validar
 * inmediatamente. Mantenemos la fila con status='revoked' para auditoria.
 * @param {import('better-sqlite3').Database} db
 * @param {string} deviceId
 */
export function revokeDevice(db, deviceId) {
  db.prepare(/* sql */ `
    UPDATE devices SET status = 'revoked', revoked_at = ?
    WHERE device_id = ?
  `).run(new Date().toISOString(), deviceId);
}

/** Renombra un device aprobado. */
export function renameDevice(db, deviceId, newName) {
  if (!newName || newName.length > 80) throw new Error('invalid name');
  db.prepare('UPDATE devices SET display_name = ? WHERE device_id = ?')
    .run(newName, deviceId);
}

/**
 * Consulta estado de un pareo en curso. Devuelve `approved` (con token)
 * si ya fue aprobado, `pending` si sigue en cola, `rejected` si caduco
 * o nunca existio.
 * @param {import('better-sqlite3').Database} db
 * @param {string} deviceId
 * @returns {{ status: 'approved'|'pending'|'rejected', deviceToken?: string, displayName?: string }}
 */
export function getPairStatus(db, deviceId) {
  const dev = db.prepare(
    "SELECT device_token, display_name, status FROM devices WHERE device_id = ?"
  ).get(deviceId);
  if (dev?.status === 'approved') {
    return {
      status: 'approved',
      deviceToken: dev.device_token,
      displayName: dev.display_name,
    };
  }
  if (dev?.status === 'revoked') {
    return { status: 'rejected' };
  }

  const pr = db.prepare(
    'SELECT expires_at, display_name FROM pair_requests WHERE device_id = ?'
  ).get(deviceId);
  if (!pr) return { status: 'rejected' };
  if (new Date(pr.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM pair_requests WHERE device_id = ?').run(deviceId);
    return { status: 'rejected' };
  }
  return { status: 'pending', displayName: pr.display_name };
}

/**
 * Resuelve un device por su token. Devuelve null si no existe o esta
 * revocado. Actualiza last_seen_at.
 * @param {import('better-sqlite3').Database} db
 * @param {string} token
 * @returns {DeviceRow|null}
 */
export function findDeviceByToken(db, token) {
  if (!token) return null;
  const row = db.prepare(
    "SELECT * FROM devices WHERE device_token = ? AND status = 'approved'"
  ).get(token);
  if (!row) return null;
  // last_seen update — best effort, no transaction.
  try {
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ?')
      .run(new Date().toISOString(), row.device_id);
  } catch {}
  return row;
}

/** Lista devices aprobados + revocados (no pair_requests). */
export function listDevices(db) {
  return db.prepare(/* sql */ `
    SELECT device_id, display_name, supabase_user_id, status,
           cookies_updated_at, approved_at, last_seen_at, revoked_at
    FROM devices
    ORDER BY
      CASE status WHEN 'approved' THEN 0 ELSE 1 END,
      last_seen_at DESC NULLS LAST,
      approved_at DESC
  `).all();
}

/** Lista solicitudes de pareo pendientes (no caducadas). */
export function listPairRequests(db) {
  const now = new Date().toISOString();
  // Limpieza inline de caducadas.
  db.prepare('DELETE FROM pair_requests WHERE expires_at < ?').run(now);
  return db.prepare(/* sql */ `
    SELECT device_id, display_name, supabase_user_id, pin,
           requested_at, expires_at, client_ip,
           CASE WHEN cookies_blob IS NULL THEN 0 ELSE 1 END AS has_cookies
    FROM pair_requests
    ORDER BY requested_at DESC
  `).all();
}

/**
 * Inserta un evento de actividad.
 * @param {import('better-sqlite3').Database} db
 * @param {Object} entry
 * @param {string} entry.deviceId
 * @param {string} entry.action
 * @param {string|null} [entry.trackId]
 * @param {string|null} [entry.ytId]
 * @param {Object|null} [entry.meta]
 */
export function logActivity(db, { deviceId, action, trackId = null, ytId = null, meta = null }) {
  if (!deviceId || !action) return;
  try {
    db.prepare(/* sql */ `
      INSERT INTO device_activity (device_id, action, track_id, yt_id, meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      deviceId, action, trackId, ytId,
      meta ? JSON.stringify(meta) : null,
      new Date().toISOString(),
    );
  } catch (err) {
    console.warn('[devices] logActivity failed:', err.message);
  }
}

/**
 * Actualiza las cookies de un device aprobado.
 * @param {import('better-sqlite3').Database} db
 * @param {string} deviceId
 * @param {Buffer} cookiesBlob  Ya cifrado (caller debe usar encryptCookies).
 */
export function updateDeviceCookies(db, deviceId, cookiesBlob) {
  if (!deviceId || !cookiesBlob) throw new Error('deviceId, cookiesBlob required');
  const r = db.prepare(/* sql */ `
    UPDATE devices SET cookies_blob = ?, cookies_updated_at = ?
    WHERE device_id = ? AND status = 'approved'
  `).run(cookiesBlob, new Date().toISOString(), deviceId);
  if (r.changes === 0) throw new Error('device not found or not approved');
}

/** Actividad de un device (ultimos N eventos). */
export function getDeviceActivity(db, deviceId, limit = 100) {
  return db.prepare(/* sql */ `
    SELECT id, action, track_id, yt_id, meta, created_at
    FROM device_activity
    WHERE device_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(deviceId, Math.min(Math.max(limit, 1), 500));
}

/**
 * Rotacion: borra actividad mas vieja que `daysToKeep` dias.
 * Llamar al arrancar y periodicamente.
 * @param {import('better-sqlite3').Database} db
 * @param {number} daysToKeep
 * @returns {number} filas borradas
 */
export function pruneOldActivity(db, daysToKeep = 5) {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 3600 * 1000).toISOString();
  const r = db.prepare('DELETE FROM device_activity WHERE created_at < ?').run(cutoff);
  return r.changes ?? 0;
}

/**
 * Sugerencia de display name humanizada a partir del UA. Best-effort,
 * el cliente puede sobrescribir.
 * @param {string} ua
 */
export function deriveDisplayNameFromUA(ua) {
  if (!ua) return 'Dispositivo';
  const s = String(ua);
  if (/iPhone/.test(s)) return 'iPhone';
  if (/iPad/.test(s)) return 'iPad';
  if (/Android/.test(s)) return 'Android';
  if (/Macintosh/.test(s)) return 'Mac';
  if (/Windows/.test(s)) return 'Windows';
  if (/Linux/.test(s)) return 'Linux';
  return 'Dispositivo';
}

/** Genera un device_id aleatorio (helper para tests). */
export function newDeviceId() {
  return randomUUID();
}
