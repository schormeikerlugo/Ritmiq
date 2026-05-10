/**
 * Gestor del Cloudflare Tunnel embebido.
 *
 * - Descubre el binario cloudflared (bundled o descargado).
 * - Arranca un Named Tunnel a partir de un token guardado por el usuario
 *   en `userData/tunnel-token.txt`.
 * - Expone estado, URL pública y métodos start/stop.
 * - Auto-restart si el proceso muere.
 *
 * @module main/cloudflared
 */

import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path del binario cloudflared (bundled o dev). */
function getCloudflaredPath() {
  const bin = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  if (app.isPackaged) {
    const packed = join(process.resourcesPath, 'bin', bin);
    if (existsSync(packed)) return packed;
  }
  const dev = join(__dirname, '..', 'bin', bin);
  if (existsSync(dev)) return dev;
  return bin; // fallback PATH
}

function tokenPath() {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'tunnel-token.txt');
}

/** @returns {string|null} */
export function getStoredToken() {
  try {
    const p = tokenPath();
    if (!existsSync(p)) return null;
    return readFileSync(p, 'utf8').trim() || null;
  } catch { return null; }
}

/** @param {string|null} token */
export function setStoredToken(token) {
  const p = tokenPath();
  if (!token) {
    try { unlinkSync(p); } catch {}
    return;
  }
  writeFileSync(p, token.trim(), 'utf8');
}

/**
 * @typedef {Object} TunnelState
 * @property {'idle'|'connecting'|'connected'|'error'} status
 * @property {string|null} url
 * @property {string|null} error
 */

class CloudflaredManager {
  constructor() {
    /** @type {import('node:child_process').ChildProcess|null} */
    this.process = null;
    /** @type {TunnelState} */
    this.state = { status: 'idle', url: null, error: null };
    /** @type {Set<(s: TunnelState) => void>} */
    this.listeners = new Set();
    /** @type {NodeJS.Timeout|null} */
    this.restartTimer = null;
    /** Si el usuario llama stop manualmente, no autoreiniciar. */
    this.intentStopped = true;
  }

  /** @param {(s: TunnelState) => void} cb */
  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit() {
    for (const cb of this.listeners) {
      try { cb({ ...this.state }); } catch {}
    }
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  isRunning() {
    return !!this.process && !this.process.killed;
  }

  /** Inicia el tunnel con el token almacenado. */
  async start() {
    const token = getStoredToken();
    if (!token) {
      this.setState({ status: 'error', url: null, error: 'No hay token de tunnel configurado.' });
      return;
    }
    if (this.isRunning()) return;

    const bin = getCloudflaredPath();
    if (!bin || !existsSync(bin)) {
      // fallback al PATH también puede no existir; lo intentamos igual.
    }

    this.intentStopped = false;
    this.setState({ status: 'connecting', error: null });

    const child = spawn(bin, ['tunnel', '--no-autoupdate', 'run', '--token', token], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process = child;

    const onLine = (line) => {
      const text = String(line);
      // cloudflared emite líneas con timestamp + message. Buscar URL pública.
      // Para Named Tunnels, suelen aparecer "Connection registered" o
      // similares pero no la URL final (depende de la config en CF).
      // Extraemos URL si aparece formato `https://<name>.cfargotunnel.com`
      // o `https://<name>.trycloudflare.com`.
      const m = text.match(/https:\/\/[a-z0-9-]+\.(cfargotunnel\.com|trycloudflare\.com)/);
      if (m && this.state.url !== m[0]) {
        this.setState({ status: 'connected', url: m[0], error: null });
      }
      // Otra señal: "Registered tunnel connection".
      if (text.includes('Registered tunnel connection')) {
        if (this.state.status !== 'connected') {
          this.setState({ status: 'connected', error: null });
        }
      }
    };

    child.stdout.on('data', (b) => b.toString().split('\n').forEach(onLine));
    child.stderr.on('data', (b) => b.toString().split('\n').forEach(onLine));

    child.on('error', (err) => {
      this.setState({ status: 'error', error: `Spawn falló: ${err.message}` });
    });

    child.on('exit', (code, signal) => {
      this.process = null;
      if (this.intentStopped) {
        this.setState({ status: 'idle', url: null });
        return;
      }
      this.setState({
        status: 'error',
        error: `cloudflared salió (code=${code} signal=${signal})`,
      });
      // Auto-restart con backoff de 10s si no fue intencional.
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => this.start(), 10_000);
    });
  }

  /** Detiene el tunnel y evita el auto-restart. */
  async stop() {
    this.intentStopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      // Por si SIGTERM no llega
      setTimeout(() => {
        if (this.process && !this.process.killed) this.process.kill('SIGKILL');
      }, 3000);
    }
    this.setState({ status: 'idle', url: null });
  }

  /** Reinicia con el token actual. */
  async restart() {
    await this.stop();
    // Pequeño delay para que el OS libere el child
    setTimeout(() => this.start(), 500);
  }
}

export const cloudflared = new CloudflaredManager();
