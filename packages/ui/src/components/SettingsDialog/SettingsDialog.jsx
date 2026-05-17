import { useEffect, useState } from 'react';
import {
  getLanBaseUrlSync, setLanBaseUrl, pingLan,
  getTunnelUrlSync, setTunnelUrl,
  getAccessTokenSync, setAccessToken,
} from '../../lib/lan-client.js';
import { api, isDesktop } from '../../lib/api.js';
import { publishTunnelUrl, clearTunnelUrl } from '../../lib/tunnel-registry.js';
import { supabase } from '../../lib/supabase.js';
import { forceRecheck } from '../../lib/connectivity.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './SettingsDialog.module.css';

/**
 * Diálogo para configurar la conexión LAN con el PC.
 * - Auto-prueba IPs comunes de LAN (192.168.0.x, 192.168.1.x) en puerto 3939.
 * - Permite introducir manualmente la URL completa.
 *
 * @param {Object} props
 * @param {() => void} props.onClose
 */
export function SettingsDialog({ onClose }) {
  const [value, setValue] = useState(getLanBaseUrlSync() ?? '');
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState(null);
  const [statusOk, setStatusOk] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const test = async (url) => {
    setStatusMsg('Probando conexión…');
    setStatusOk(false);
    const normalized = normalize(url);
    const ok = await pingLan(normalized, 1500);
    if (ok) {
      setStatusMsg(`✓ Conectado a ${normalized}`);
      setStatusOk(true);
      setLanBaseUrl(normalized);
      setValue(normalized);
    } else {
      setStatusMsg('No se pudo conectar. Verifica IP, puerto y que la app de escritorio esté abierta.');
      setStatusOk(false);
    }
  };

  const onSave = async () => {
    if (!value.trim()) {
      setLanBaseUrl(null);
      setStatusMsg('Conexión LAN borrada.');
      setStatusOk(true);
      return;
    }
    await test(value);
  };

  const onAutoScan = async () => {
    setScanning(true);
    setStatusMsg('Buscando tu PC en la red…');
    setStatusOk(false);
    setScanProgress(0);

    // Probamos las /24 más comunes en redes domésticas + ISP variados.
    const subnets = [
      '192.168.0', '192.168.1', '192.168.2', '192.168.3',
      '192.168.10', '192.168.50', '192.168.68', '192.168.86',
      '192.168.100', '192.168.101',
      '10.0.0', '10.0.1', '10.10.10',
      '172.16.0', '172.20.10',
    ];
    const port = 3939;
    let found = null;

    const ips = [];
    for (const sub of subnets) {
      for (let i = 1; i < 255; i++) ips.push(`${sub}.${i}`);
    }

    // Concurrencia 30 para no saturar
    const total = ips.length;
    let done = 0;
    const workers = 30;
    let cursor = 0;

    const worker = async () => {
      while (cursor < total && !found) {
        const ip = ips[cursor++];
        const url = `http://${ip}:${port}`;
        const ok = await pingLan(url, 250);
        done++;
        setScanProgress(Math.round((done / total) * 100));
        if (ok && !found) {
          found = url;
          break;
        }
      }
    };

    await Promise.all(Array.from({ length: workers }, worker));

    setScanning(false);
    if (found) {
      setStatusMsg(`✓ Encontrado en ${found}`);
      setStatusOk(true);
      setValue(found);
      setLanBaseUrl(found);
    } else {
      setStatusMsg('No encontré tu PC. Introduce la IP manualmente.');
      setStatusOk(false);
    }
  };

  const onClear = () => {
    setValue('');
    setLanBaseUrl(null);
    setStatusMsg('Conexión LAN borrada.');
    setStatusOk(true);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>Conexión con tu PC</h2>
          <button
            className={styles.close}
            onClick={onClose}
            aria-label="Cerrar"
          ><Icon name="X" size={18} /></button>
        </header>

        <p className={styles.intro}>
          Para buscar y reproducir música desde el móvil, conecta con la app
          de escritorio que está corriendo en tu PC en la misma WiFi.
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="lan-url">
            Dirección del servidor
          </label>
          <input
            id="lan-url"
            className={styles.input}
            type="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="http://192.168.1.50:3939"
            disabled={scanning}
          />
          <p className={styles.hint}>
            Ejemplo: <code>http://192.168.1.50:3939</code>
          </p>
        </div>

        {scanning && (
          <div className={styles.scanBar}>
            <div className={styles.scanFill} style={{ width: `${scanProgress}%` }} />
          </div>
        )}

        {statusMsg && (
          <p className={styles.status} data-ok={statusOk}>
            {statusMsg}
          </p>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={onClear}
            disabled={scanning}
          >Borrar</button>
          <div className={styles.spacer} />
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={onAutoScan}
            disabled={scanning}
          >{scanning ? 'Buscando…' : 'Auto-detectar'}</button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={onSave}
            disabled={scanning}
          >Probar y guardar</button>
        </div>

        {isDesktop && <YtDlpSection />}
        {isDesktop && <SharedCacheSection />}
        {isDesktop && <DesktopTunnelSection />}
        {isDesktop && <DesktopAccessTokenSection />}
        {!isDesktop && <PwaRemoteSection />}
      </div>
    </div>
  );
}

/**
 * Sección de gestión del binario yt-dlp (sólo visible en desktop).
 */
function YtDlpSection() {
  const [info, setInfo] = useState({ path: null, version: null });
  const [updating, setUpdating] = useState(false);
  const [msg, setMsg] = useState(null);
  const [msgOk, setMsgOk] = useState(false);

  const refresh = async () => {
    try { setInfo(await api.ytdlpInfo()); } catch {}
  };

  useEffect(() => { refresh(); }, []);

  const onUpdate = async () => {
    setUpdating(true);
    setMsg('Descargando última versión…');
    setMsgOk(false);
    try {
      const next = await api.ytdlpUpdate();
      setInfo(next);
      setMsg(`✓ Actualizado a ${next.version ?? '?'}`);
      setMsgOk(true);
    } catch (err) {
      setMsg(`Error: ${String(err?.message ?? err)}`);
      setMsgOk(false);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className={styles.field} style={{ marginTop: '1.25rem' }}>
      <label className={styles.label}>Motor de YouTube (yt-dlp)</label>
      <p className={styles.hint}>
        Versión instalada: <code>{info.version ?? '—'}</code>
      </p>
      {msg && (
        <p className={styles.status} data-ok={msgOk}>
          {msg}
        </p>
      )}
      <div className={styles.actions}>
        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={onUpdate}
          disabled={updating}
        >{updating ? 'Actualizando…' : 'Actualizar yt-dlp'}</button>
      </div>
    </div>
  );
}

/**
 * Cache compartido entre cuentas. Cuando la PWA descarga un track
 * vía /download/, el archivo queda en el PC indexado por ytId. Si otra
 * cuenta reproduce el mismo ytId desde otro dispositivo, recibe el
 * archivo desde disco sin re-descargar. Este panel muestra cuánto espacio
 * ocupa y permite vaciarlo.
 */
function SharedCacheSection() {
  const [stats, setStats] = useState({ count: 0, totalBytes: 0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [msgOk, setMsgOk] = useState(false);

  const refresh = async () => {
    try { setStats(await api.sharedCacheStats()); } catch {}
  };
  useEffect(() => { refresh(); }, []);

  const onClear = async () => {
    if (!confirm(
      'Esto borra los archivos de audio descargados que se reusan entre ' +
      'cuentas. La próxima reproducción de cada canción volverá a descargar ' +
      'desde YouTube. ¿Continuar?'
    )) return;
    setBusy(true);
    setMsg('Borrando…');
    try {
      const r = await api.sharedCacheClear();
      setMsg(`✓ Liberados ${formatBytes(r.freedBytes)} (${r.removed} archivos)`);
      setMsgOk(true);
      await refresh();
    } catch (err) {
      setMsg(`Error: ${String(err?.message ?? err)}`);
      setMsgOk(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.field} style={{ marginTop: '1.25rem' }}>
      <label className={styles.label}>Caché compartido entre cuentas</label>
      <p className={styles.hint}>
        Archivos descargados que se reusan automáticamente cuando otra cuenta
        en otro dispositivo reproduce la misma canción. Acelera la primera
        reproducción y evita descargas duplicadas.
      </p>
      <p className={styles.hint}>
        Actualmente: <code>{stats.count}</code> canciones · <code>{formatBytes(stats.totalBytes)}</code>
      </p>
      {msg && (
        <p className={styles.status} data-ok={msgOk}>{msg}</p>
      )}
      <div className={styles.actions}>
        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={onClear}
          disabled={busy || stats.count === 0}
        >{busy ? 'Borrando…' : 'Limpiar caché compartido'}</button>
      </div>
    </div>
  );
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function normalize(s) {
  let u = (s ?? '').trim();
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = `http://${u}`;
  // Si no trae puerto, asumimos 3939
  try {
    const parsed = new URL(u);
    if (!parsed.port) parsed.port = '3939';
    return parsed.origin;
  } catch {
    return u.replace(/\/$/, '');
  }
}

/**
 * Desktop: gestiona el Cloudflare Tunnel embebido. Permite pegar el token
 * desde Cloudflare Zero Trust y arranca/para el tunnel automáticamente.
 */
function DesktopTunnelSection() {
  const [token, setToken] = useState('');
  const [customUrl, setCustomUrlInput] = useState('');
  const [state, setState] = useState({
    status: 'idle', url: null, error: null, hasToken: false, customUrl: null,
  });
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const s = await api.tunnelStatus();
      setState(s);
      if (s.customUrl && !customUrl) setCustomUrlInput(s.customUrl);
    } catch {}
  };

  useEffect(() => {
    refresh();
    return api.tunnelOnState((s) => setState((prev) => ({ ...prev, ...s })));
  }, []);

  const onSaveCustomUrl = async () => {
    setBusy(true);
    try {
      let url = (customUrl ?? '').trim().replace(/\/$/, '');
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      setCustomUrlInput(url); // refleja la normalización en el input
      await api.tunnelSetCustomUrl(url || null);
    } finally { setBusy(false); }
  };

  const onSave = async () => {
    setBusy(true);
    try {
      await api.tunnelSetToken(token.trim() || null);
      setToken('');
    } finally { setBusy(false); }
  };

  const onQuick = async () => {
    setBusy(true);
    try { await api.tunnelStartQuick(); } finally { setBusy(false); }
  };

  const onStop = async () => {
    setBusy(true);
    try { await api.tunnelStop(); } finally { setBusy(false); }
  };

  const statusBadge = state.status === 'connected' ? '🟢 Conectado'
                    : state.status === 'connecting' ? '🟡 Conectando…'
                    : state.status === 'error' ? '🔴 Error'
                    : '⚪ Desconectado';

  return (
    <div className={styles.field} style={{ marginTop: '1.25rem' }}>
      <label className={styles.label}>Acceso remoto (Cloudflare Tunnel)</label>
      <p className={styles.hint}>
        Dos opciones:
        <br />• <strong>Quick Tunnel (gratis, sin dominio)</strong>: URL aleatoria
          tipo <code>*.trycloudflare.com</code>. Cambia al reiniciar la app.
        <br />• <strong>Named Tunnel (persistente)</strong>: requiere dominio en
          Cloudflare. Pega el token de{' '}
          <code>Zero Trust → Networks → Tunnels → Create</code>.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.5rem 0' }}>
        <span>{statusBadge}</span>
        {state.url && (
          <button
            type="button"
            className={styles.btnSecondary}
            style={{ height: 28, padding: '0 0.5rem', fontSize: '0.75rem' }}
            onClick={() => navigator.clipboard.writeText(state.url)}
          >Copiar URL pública</button>
        )}
      </div>

      {state.url && (
        <p className={styles.hint}>
          URL: <code style={{ wordBreak: 'break-all' }}>{state.url}</code>
        </p>
      )}
      {state.error && (
        <p className={styles.status} data-ok={false}>{state.error}</p>
      )}

      <input
        className={styles.input}
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder={state.hasToken ? '••• token guardado (pega uno nuevo para cambiar) •••' : 'Pega el token de Cloudflare Tunnel'}
        disabled={busy}
        autoComplete="off"
      />

      <p className={styles.hint} style={{ marginTop: '0.75rem' }}>
        <strong>URL pública (solo Named Tunnel con dominio propio)</strong>:
        si tu Public Hostname es <code>ritmiq.tudominio.com</code>, escríbela
        aquí. cloudflared no la imprime en los logs así que el AppImage no
        puede detectarla sola.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          className={styles.input}
          type="url"
          value={customUrl}
          onChange={(e) => setCustomUrlInput(e.target.value)}
          placeholder="https://ritmiq.tudominio.com"
          disabled={busy}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={onSaveCustomUrl}
          disabled={busy}
          style={{ height: 40, padding: '0 0.75rem' }}
        >Guardar URL</button>
      </div>
      <div className={styles.actions}>
        {(state.status === 'connected' || state.status === 'connecting') && (
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={onStop}
            disabled={busy}
          >Detener</button>
        )}
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={onQuick}
          disabled={busy}
        >{busy ? '…' : 'Quick Tunnel (gratis)'}</button>
        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={onSave}
          disabled={busy || !token.trim()}
        >{busy ? 'Aplicando…' : (state.hasToken ? 'Reemplazar token' : 'Guardar token')}</button>
      </div>
    </div>
  );
}

/**
 * Desktop: muestra el token de acceso (Bearer) que el usuario debe
 * configurar en la PWA para autenticar peticiones.
 */
function DesktopAccessTokenSection() {
  const [token, setTokenValue] = useState('');
  const [revealed, setRevealed] = useState(false);

  const refresh = async () => {
    try { setTokenValue(await api.authToken() ?? ''); } catch {}
  };

  useEffect(() => { refresh(); }, []);

  const onCopy = () => {
    navigator.clipboard.writeText(token);
  };

  const onRegen = async () => {
    if (!confirm('Regenerar el token invalida los clientes ya configurados. ¿Continuar?')) return;
    setTokenValue(await api.authRegenerateToken());
  };

  const masked = token ? token.slice(0, 4) + '•••••••••••••••••••••' + token.slice(-4) : '—';

  return (
    <div className={styles.field} style={{ marginTop: '1.25rem' }}>
      <label className={styles.label}>Token de acceso para clientes externos</label>
      <p className={styles.hint}>
        Cópialo y pégalo en la PWA → Ajustes → "Token". Necesario sólo cuando
        accedes vía Tunnel; en la misma WiFi LAN no hace falta.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <code style={{
          flex: 1, padding: '0.5rem', background: 'var(--color-bg-2)',
          borderRadius: 6, fontSize: '0.75rem', wordBreak: 'break-all',
        }}>{revealed ? token : masked}</code>
        <button
          type="button"
          className={styles.btnSecondary}
          style={{ height: 32, padding: '0 0.75rem' }}
          onClick={() => setRevealed((v) => !v)}
        >{revealed ? 'Ocultar' : 'Mostrar'}</button>
      </div>
      <div className={styles.actions} style={{ marginTop: '0.5rem' }}>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={onRegen}
        >Regenerar token</button>
        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={onCopy}
          disabled={!token}
        >Copiar al portapapeles</button>
      </div>
    </div>
  );
}

/**
 * PWA: configurar URL del Cloudflare Tunnel del PC + token de acceso.
 */
function PwaRemoteSection() {
  const [tunnel, setTunnelInput] = useState(getTunnelUrlSync() ?? '');
  const [token, setTokenInput] = useState(getAccessTokenSync() ?? '');
  const [msg, setMsg] = useState(null);
  const [msgOk, setMsgOk] = useState(false);
  const [testing, setTesting] = useState(false);

  const onSave = async () => {
    setTesting(true);
    setMsg('Probando conexión…');
    try {
      const url = (tunnel ?? '').trim().replace(/\/$/, '');
      const tok = (token ?? '').trim();
      if (url) {
        // Test el tunnel respondiendo /health (no requiere token).
        const ok = await pingLan(url, 4000);
        if (!ok) {
          setMsg('No se pudo alcanzar la URL. Verifica que el tunnel esté activo.');
          setMsgOk(false);
          return;
        }
      }
      // 1) localStorage (acceso síncrono inmediato).
      setTunnelUrl(url || null);
      setAccessToken(tok || null);

      // 2) Respaldo en Supabase ligado al usuario: sobrevive a evicción de
      //    localStorage (iOS Safari, modo incógnito, reinstalación de la
      //    PWA) y sincroniza el acceso a otros dispositivos del mismo user.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (userId) {
          if (url) {
            const source = /\.trycloudflare\.com$/.test(url) ? 'quick'
                         : /\.cfargotunnel\.com$/.test(url) ? 'named'
                         : 'custom';
            await publishTunnelUrl(userId, url, source, tok || null);
          } else {
            await clearTunnelUrl(userId);
          }
        }
      } catch (e) {
        console.warn('[settings] respaldo en Supabase falló:', e?.message ?? e);
      }

      // 3) Forzar re-sondeo del detector para que el indicador refleje
      //    inmediatamente que el tunnel está disponible.
      try { forceRecheck(); } catch {}

      setMsg(url ? `✓ Tunnel guardado y respaldado` : 'Tunnel borrado');
      setMsgOk(true);
    } finally { setTesting(false); }
  };

  return (
    <div className={styles.field} style={{ marginTop: '1.25rem' }}>
      <label className={styles.label}>Acceso remoto (cuando estás fuera de tu WiFi)</label>
      <p className={styles.hint}>
        Si tu PC tiene un Cloudflare Tunnel configurado, pega aquí su URL
        pública y el token de acceso.
      </p>
      <input
        className={styles.input}
        type="url"
        value={tunnel}
        onChange={(e) => setTunnelInput(e.target.value)}
        placeholder="https://nombre.cfargotunnel.com"
        disabled={testing}
      />
      <input
        className={styles.input}
        style={{ marginTop: '0.5rem' }}
        type="password"
        value={token}
        onChange={(e) => setTokenInput(e.target.value)}
        placeholder="Token de acceso del PC"
        disabled={testing}
        autoComplete="off"
      />
      {msg && (
        <p className={styles.status} data-ok={msgOk}>{msg}</p>
      )}
      <div className={styles.actions}>
        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={onSave}
          disabled={testing}
        >{testing ? 'Probando…' : 'Guardar'}</button>
      </div>
    </div>
  );
}
