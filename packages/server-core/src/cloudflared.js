/**
 * Gestor del Cloudflare Tunnel embebido (portable: desktop + headless).
 *
 * - Descubre el binario cloudflared (host.resourcesBinDir / host.devBinDir /
 *   RITMIQ_CLOUDFLARED_PATH / PATH).
 * - Named Tunnel a partir de un token guardado en `<dataDir>/tunnel-token.txt`
 *   (o RITMIQ_TUNNEL_TOKEN en headless).
 * - Quick Tunnel si no hay token (URL aleatoria `*.trycloudflare.com`).
 * - Expone estado, URL pública y start/stop. Auto-restart si el proceso muere.
 *
 * @module @ritmiq/server-core/cloudflared
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getHost, dataPath } from './host.js';

/** Path del binario cloudflared. */
function getCloudflaredPath() {
  const bin = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const envOverride = process.env.RITMIQ_CLOUDFLARED_PATH;
  if (envOverride && existsSync(envOverride)) return envOverride;
  const host = getHost();
  if (host.resourcesBinDir) {
    const packed = join(host.resourcesBinDir, bin);
    if (existsSync(packed)) return packed;
  }
  if (host.devBinDir) {
    const dev = join(host.devBinDir, bin);
    if (existsSync(dev)) return dev;
  }
  return bin; // fallback PATH
}

function tokenPath() { return dataPath('tunnel-token.txt'); }
function customUrlPath() { return dataPath('tunnel-custom-url.txt'); }

/** @returns {string|null} */
export function getStoredToken() {
  // Env override tiene prioridad (headless / systemd).
  if (process.env.RITMIQ_TUNNEL_TOKEN) return process.env.RITMIQ_TUNNEL_TOKEN.trim() || null;
  try {
    const p = tokenPath();
    if (!existsSync(p)) return null;
    return readFileSync(p, 'utf8').trim() || null;
  } catch { return null; }
}

/** @param {string|null} token */
export function setStoredToken(token) {
  const p = tokenPath();
  if (!token) { try { unlinkSync(p); } catch {} return; }
  writeFileSync(p, token.trim(), 'utf8');
}

/** @returns {string|null} */
export function getCustomUrl() {
  if (process.env.RITMIQ_TUNNEL_CUSTOM_URL) {
    return normalizeUrl(process.env.RITMIQ_TUNNEL_CUSTOM_URL);
  }
  try {
    const p = customUrlPath();
    if (!existsSync(p)) return null;
    return readFileSync(p, 'utf8').trim() || null;
  } catch { return null; }
}

function normalizeUrl(url) {
  let n = String(url).trim();
  if (n && !/^https?:\/\//i.test(n)) n = 'https://' + n;
  return n.replace(/\/$/, '');
}

/** @param {string|null} url */
export function setCustomUrl(url) {
  const p = customUrlPath();
  if (!url) { try { unlinkSync(p); } catch {} return; }
  writeFileSync(p, normalizeUrl(url), 'utf8');
}

/**
 * @typedef {Object} TunnelState
 * @property {'idle'|'connecting'|'connected'|'error'} status
 * @property {string|null} url
 * @property {string|null} error
 */

export class CloudflaredManager {
  /** @param {{ port?: number }} [opts] */
  constructor(opts = {}) {
    this.port = opts.port ?? 3939;
    /** @type {import('node:child_process').ChildProcess|null} */
    this.process = null;
    /** @type {TunnelState} */
    this.state = { status: 'idle', url: null, error: null };
    /** @type {Set<(s: TunnelState) => void>} */
    this.listeners = new Set();
    /** @type {NodeJS.Timeout|null} */
    this.restartTimer = null;
    this.intentStopped = true;
  }

  onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  emit() { for (const cb of this.listeners) { try { cb({ ...this.state }); } catch {} } }
  setState(patch) { this.state = { ...this.state, ...patch }; this.emit(); }
  isRunning() { return !!this.process && !this.process.killed; }

  /** @param {{ mode?: 'auto'|'quick'|'named' }} [opts] */
  async start(opts = {}) {
    const token = getStoredToken();
    const mode = opts.mode === 'quick' ? 'quick'
               : opts.mode === 'named' ? 'named'
               : (token ? 'named' : 'quick');

    if (mode === 'named' && !token) {
      this.setState({ status: 'error', url: null, error: 'No hay token de tunnel configurado.' });
      return;
    }
    if (this.isRunning()) return;

    const bin = getCloudflaredPath();
    this.intentStopped = false;
    this.setState({ status: 'connecting', error: null });

    const args = mode === 'quick'
      ? ['tunnel', '--no-autoupdate', '--url', `http://localhost:${this.port}`]
      : ['tunnel', '--no-autoupdate', 'run', '--token', token];

    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = child;

    const onLine = (line) => {
      const text = String(line);
      const m = text.match(/https:\/\/[a-z0-9-]+\.(cfargotunnel\.com|trycloudflare\.com)/);
      if (m && this.state.url !== m[0]) {
        this.setState({ status: 'connected', url: m[0], error: null });
      }
      if (text.includes('Registered tunnel connection') && this.state.status !== 'connected') {
        this.setState({ status: 'connected', error: null });
      }
    };
    child.stdout.on('data', (b) => b.toString().split('\n').forEach(onLine));
    child.stderr.on('data', (b) => b.toString().split('\n').forEach(onLine));
    child.on('error', (err) => this.setState({ status: 'error', error: `Spawn falló: ${err.message}` }));
    child.on('exit', (code, signal) => {
      this.process = null;
      if (this.intentStopped) { this.setState({ status: 'idle', url: null }); return; }
      this.setState({ status: 'error', error: `cloudflared salió (code=${code} signal=${signal})` });
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => this.start(), 10_000);
    });

    // URL custom (Named Tunnel con dominio propio): cloudflared no la imprime.
    setTimeout(() => {
      const custom = getCustomUrl();
      if (custom && this.state.status === 'connecting') {
        this.setState({ status: 'connected', url: custom });
      } else if (custom && this.state.status === 'connected' && !this.state.url) {
        this.setState({ url: custom });
      }
    }, 8000);
  }

  async stop() {
    this.intentStopped = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      setTimeout(() => { if (this.process && !this.process.killed) this.process.kill('SIGKILL'); }, 3000);
    }
    this.setState({ status: 'idle', url: null });
  }

  async restart() {
    await this.stop();
    setTimeout(() => this.start(), 500);
  }
}
