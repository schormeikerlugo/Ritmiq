/**
 * Orquestador del login de YouTube por navegador headless (Fase 3b).
 *
 * Levanta BAJO DEMANDA un contenedor `ritmiq-login` (Chromium + noVNC +
 * agente Playwright). El usuario abre la pantalla noVNC, inicia sesión en
 * YouTube, y el agente detecta la sesión, exporta las cookies y las sube al
 * servidor principal (`/cookies/upload`) con el device_token de la sesión.
 *
 * El servidor principal solo orquesta (arranca/monitorea/limpia el
 * contenedor). No maneja cookies aquí — eso lo hace el agente contra el
 * endpoint ya existente. El contenedor se autodestruye al terminar.
 *
 * Requisitos en el host: Docker disponible y la imagen `ritmiq-login`
 * construida. Config por env:
 *   RITMIQ_LOGIN_IMAGE      (default 'ritmiq-login:latest')
 *   RITMIQ_LOGIN_PORT_BASE  (default 6080) — puerto noVNC base
 *   RITMIQ_PUBLIC_HOST      host público para construir la URL noVNC
 *                           (default: se resuelve desde la request)
 *   RITMIQ_SERVER_INTERNAL_URL  URL que el contenedor usa para alcanzar al
 *                           servidor (default http://host.docker.internal:PORT)
 *
 * @module @ritmiq/server-core/youtube-login
 */
import { spawn, execFile } from 'node:child_process';

const IMAGE = process.env.RITMIQ_LOGIN_IMAGE || 'ritmiq-login:latest';
const PORT_BASE = Number(process.env.RITMIQ_LOGIN_PORT_BASE ?? 6080);
const SESSION_TTL_MS = 6 * 60 * 1000; // el agente usa 5 min; damos 6 de margen

/**
 * @typedef {Object} LoginSession
 * @property {string} deviceId
 * @property {string} containerName
 * @property {number} novncPort
 * @property {'starting'|'running'|'linked'|'error'|'expired'} status
 * @property {number} startedAt
 * @property {string|null} error
 */

/** @type {Map<string, LoginSession>} */
const sessions = new Map();
let portCursor = 0;

function nextPort() {
  const p = PORT_BASE + (portCursor % 20);
  portCursor++;
  return p;
}

/** Ejecuta docker y devuelve stdout. */
function docker(args) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(String(stdout).trim());
    });
  });
}

/**
 * Inicia una sesión de login para un dispositivo. Idempotente: si ya hay una
 * activa para ese device, la devuelve.
 *
 * @param {Object} opts
 * @param {string} opts.deviceId
 * @param {string} opts.deviceToken
 * @param {number} opts.serverPort  Puerto del servidor principal (para el agente).
 * @returns {Promise<{ novncPort:number, status:string }>}
 */
export async function startLoginSession({ deviceId, deviceToken, serverPort }) {
  const existing = sessions.get(deviceId);
  if (existing && (existing.status === 'starting' || existing.status === 'running')) {
    return { novncPort: existing.novncPort, status: existing.status };
  }

  const novncPort = nextPort();
  const containerName = `ritmiq-login-${deviceId.slice(0, 8)}-${Date.now()}`;
  // El contenedor alcanza al servidor principal. Con --network host (Linux)
  // localhost del contenedor == host. Permitimos override para otros setups.
  const serverUrl = process.env.RITMIQ_SERVER_INTERNAL_URL
    || `http://localhost:${serverPort}`;

  const session = {
    deviceId, containerName, novncPort,
    status: 'starting', startedAt: Date.now(), error: null,
  };
  sessions.set(deviceId, session);

  // docker run --rm -d con red host y las env del agente.
  const args = [
    'run', '--rm', '-d',
    '--name', containerName,
    '--network', 'host',
    '-e', `NOVNC_PORT=${novncPort}`,
    '-e', `RITMIQ_SERVER_URL=${serverUrl}`,
    '-e', `RITMIQ_DEVICE_TOKEN=${deviceToken}`,
    '-e', `RITMIQ_LOGIN_TIMEOUT_MS=${SESSION_TTL_MS - 30000}`,
    IMAGE,
  ];

  try {
    await docker(args);
    session.status = 'running';
  } catch (e) {
    session.status = 'error';
    session.error = e?.message ?? String(e);
    throw e;
  }

  // Auto-limpieza al expirar.
  setTimeout(() => { stopLoginSession(deviceId).catch(() => {}); }, SESSION_TTL_MS).unref?.();

  return { novncPort, status: session.status };
}

/**
 * Estado de la sesión. Consulta si el contenedor sigue vivo; si murió,
 * asume que terminó (el agente sube las cookies antes de salir → 'linked').
 *
 * @param {string} deviceId
 * @param {(deviceId:string)=>boolean} hasCookies  callback para saber si el
 *   device ya tiene cookies guardadas (el handler lo pasa consultando la DB).
 * @returns {Promise<{ status:string, novncPort:number|null }>}
 */
export async function getLoginStatus(deviceId, hasCookies) {
  const s = sessions.get(deviceId);
  if (!s) return { status: 'idle', novncPort: null };

  // ¿El contenedor sigue corriendo?
  let alive = false;
  try {
    const out = await docker(['ps', '-q', '-f', `name=${s.containerName}`]);
    alive = out.length > 0;
  } catch {}

  if (alive) {
    return { status: 'running', novncPort: s.novncPort };
  }

  // Contenedor terminó: éxito si el device ya tiene cookies, si no expiró.
  const linked = typeof hasCookies === 'function' ? !!hasCookies(deviceId) : false;
  s.status = linked ? 'linked' : 'expired';
  return { status: s.status, novncPort: null };
}

/** Detiene y limpia la sesión de un device. */
export async function stopLoginSession(deviceId) {
  const s = sessions.get(deviceId);
  if (!s) return;
  try { await docker(['rm', '-f', s.containerName]); } catch {}
  sessions.delete(deviceId);
}

/** ¿Está Docker disponible en el host? (para degradar con gracia) */
export async function isDockerAvailable() {
  try { await docker(['version', '--format', '{{.Server.Version}}']); return true; }
  catch { return false; }
}
