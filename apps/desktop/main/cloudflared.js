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

function customUrlPath() {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'tunnel-custom-url.txt');
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
 * URL pública custom (dominio propio). Cloudflared no la imprime en logs
 * para Named Tunnels con dominio custom — el usuario la configura manualmente.
 * @returns {string|null}
 */
export function getCustomUrl() {
  try {
    const p = customUrlPath();
    if (!existsSync(p)) return null;
    return readFileSync(p, 'utf8').trim() || null;
  } catch { return null; }
}

/** @param {string|null} url */
export function setCustomUrl(url) {
  const p = customUrlPath();
  if (!url) {
    try { unlinkSync(p); } catch {}
    return;
  }
  // Normalizar: añadir https:// si falta el esquema, quitar / final.
  let normalized = url.trim();
  if (normalized && !/^https?:\/\//i.test(normalized)) {
    normalized = 'https://' + normalized;
  }
  normalized = normalized.replace(/\/$/, '');
  writeFileSync(p, normalized, 'utf8');
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

  /**
   * Inicia el tunnel.
   *  - Si hay token guardado → modo Named Tunnel (persistente, requiere
   *    dominio configurado en Cloudflare).
   *  - Si no hay token → modo Quick Tunnel (URL aleatoria gratis,
   *    `*.trycloudflare.com`, cambia al reiniciar).
   *
   * @param {{ mode?: 'auto'|'quick'|'named' }} [opts]
   */
  async start(opts = {}) {
    const token = getStoredToken();
    const mode = opts.mode === 'quick' ? 'quick'
               : opts.mode === 'named' ? 'named'
               : (token ? 'named' : 'quick');

    if (mode === 'named' && !token) {
      this.setState({
        status: 'error', url: null,
        error: 'No hay token de tunnel configurado.',
      });
      return;
    }
    if (this.isRunning()) return;

    const bin = getCloudflaredPath();
    this.intentStopped = false;
    this.setState({ status: 'connecting', error: null });

    const args = mode === 'quick'
      ? ['tunnel', '--no-autoupdate', '--url', 'http://localhost:3939']
      : ['tunnel', '--no-autoupdate', 'run', '--token', token];

    const child = spawn(bin, args, {
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

    // Si el usuario tiene una URL custom guardada (Named Tunnel con dominio
    // propio), la reflejamos como URL "activa" después de unos segundos
    // independientemente de que cloudflared la imprima o no.
    setTimeout(() => {
      const custom = getCustomUrl();
      if (custom && this.state.status === 'connecting') {
        this.setState({ status: 'connected', url: custom });
      } else if (custom && this.state.status === 'connected' && !this.state.url) {
        this.setState({ url: custom });
      }
    }, 8000);
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
