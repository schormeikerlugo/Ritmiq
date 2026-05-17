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
        {isDesktop && <DevicesSection />}
        {!isDesktop && <PwaRemoteSection />}
        {!isDesktop && <PwaPairingSection />}
        {!isDesktop && <PwaDiagnosticsSection />}
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

/**
 * Desktop: gestion de devices pareados. Listado de devices aprobados,
 * solicitudes pendientes con PIN para aprobar/rechazar, y activity log.
 */
function DevicesSection() {
  const [devices, setDevices] = useState([]);
  const [pending, setPending] = useState([]);
  const [activityFor, setActivityFor] = useState(null);
  const [activity, setActivity] = useState([]);
  const [msg, setMsg] = useState(null);

  const refresh = async () => {
    try {
      const [d, p] = await Promise.all([api.devicesList(), api.devicesPending()]);
      setDevices(d ?? []);
      setPending(p ?? []);
    } catch (err) {
      console.warn('[DevicesSection] refresh failed', err);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    const unsub = api.devicesOnPairRequest?.(() => refresh());
    return () => { clearInterval(id); try { unsub?.(); } catch {} };
  }, []);

  const onApprove = async (deviceId) => {
    try {
      await api.devicesApprove(deviceId);
      setMsg({ ok: true, text: 'Dispositivo aprobado.' });
      refresh();
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message ?? err) });
    }
  };

  const onReject = async (deviceId) => {
    try {
      await api.devicesReject(deviceId);
      refresh();
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message ?? err) });
    }
  };

  const onRevoke = async (deviceId) => {
    if (!confirm('Revocar este dispositivo? Tendra que volver a pareear.')) return;
    try {
      await api.devicesRevoke(deviceId);
      refresh();
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message ?? err) });
    }
  };

  const onRename = async (deviceId, currentName) => {
    const next = prompt('Nuevo nombre:', currentName);
    if (!next || next === currentName) return;
    try {
      await api.devicesRename(deviceId, next);
      refresh();
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message ?? err) });
    }
  };

  const onViewActivity = async (deviceId) => {
    setActivityFor(deviceId);
    try {
      const log = await api.devicesActivity(deviceId, 50);
      setActivity(log ?? []);
    } catch {
      setActivity([]);
    }
  };

  return (
    <div className={styles.section}>
      <h3>Dispositivos conectados</h3>
      <p className={styles.muted}>
        Aprueba aqui los dispositivos que se conectan a este desktop. El
        PIN aparece en la pantalla del dispositivo — compaaralo con el de
        abajo antes de aprobar.
      </p>

      {pending.length > 0 && (
        <div className={styles.subBlock}>
          <h4>Solicitudes pendientes</h4>
          {pending.map((p) => (
            <div key={p.device_id} className={styles.deviceRow}>
              <div>
                <strong>{p.display_name}</strong>
                <div className={styles.muted}>
                  PIN: <code style={{ fontSize: 18 }}>{p.pin}</code>
                  {' · '}
                  {new Date(p.requested_at).toLocaleString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={styles.btnPrimary} onClick={() => onApprove(p.device_id)}>Aprobar</button>
                <button className={styles.btnSecondary} onClick={() => onReject(p.device_id)}>Rechazar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.subBlock}>
        <h4>Aprobados</h4>
        {devices.length === 0 && <div className={styles.muted}>Sin dispositivos aprobados.</div>}
        {devices.map((d) => (
          <div key={d.device_id} className={styles.deviceRow}>
            <div>
              <strong>{d.display_name}</strong>
              <div className={styles.muted}>
                {d.last_seen_at ? `Visto ${new Date(d.last_seen_at).toLocaleString()}` : 'Sin uso aun'}
                {d.cookies_updated_at ? ' · cookies subidas' : ' · cookies del owner'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={styles.btnSecondary} onClick={() => onViewActivity(d.device_id)}>Actividad</button>
              <button className={styles.btnSecondary} onClick={() => onRename(d.device_id, d.display_name)}>Renombrar</button>
              <button className={styles.btnSecondary} onClick={() => onRevoke(d.device_id)}>Revocar</button>
            </div>
          </div>
        ))}
      </div>

      {activityFor && (
        <div className={styles.subBlock}>
          <h4>Actividad del dispositivo</h4>
          <div style={{ maxHeight: 240, overflow: 'auto', fontSize: 12 }}>
            {activity.length === 0 && <div className={styles.muted}>Sin eventos.</div>}
            {activity.map((a) => (
              <div key={a.id} className={styles.muted}>
                {new Date(a.created_at).toLocaleString()} — {a.action}
                {a.yt_id ? ` (${a.yt_id})` : ''}
              </div>
            ))}
          </div>
          <button className={styles.btnSecondary} onClick={() => { setActivityFor(null); setActivity([]); }}>
            Cerrar
          </button>
        </div>
      )}

      {msg && (
        <div className={msg.ok ? styles.success : styles.error}>{msg.text}</div>
      )}
    </div>
  );
}

/**
 * PWA: pareo con un desktop. Genera device_id + PIN, hace POST /pair y
 * polling /pair/status hasta aprobacion o rechazo. Guarda el
 * device_token resultante en localStorage.
 */
function PwaPairingSection() {
  const [tunnelInput, setTunnelInput] = useState(getTunnelUrlSync() ?? '');
  const [displayName, setDisplayName] = useState(() => {
    try {
      const stored = localStorage.getItem('ritmiq:device:displayName');
      if (stored) return stored;
    } catch {}
    return navigator.userAgent.includes('iPhone') ? 'iPhone'
         : navigator.userAgent.includes('iPad') ? 'iPad'
         : navigator.userAgent.includes('Android') ? 'Android'
         : 'PWA navegador';
  });
  const [pin, setPin] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | requesting | pending | approved | rejected | error
  const [error, setError] = useState(null);

  const deviceId = (() => {
    try {
      let id = localStorage.getItem('ritmiq:device:id');
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('ritmiq:device:id', id);
      }
      return id;
    } catch {
      return null;
    }
  })();

  const existingToken = (() => {
    try { return localStorage.getItem('ritmiq:device:token'); } catch { return null; }
  })();

  const onStartPair = async () => {
    setError(null);
    setStatus('requesting');
    try {
      const baseUrl = tunnelInput.trim().replace(/\/$/, '');
      if (!baseUrl) throw new Error('Indica la URL del tunnel');
      // Generar PIN nuevo cada intento.
      const newPin = String(Math.floor(1000 + Math.random() * 9000));
      setPin(newPin);
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUserId = session?.user?.id ?? null;
      try { localStorage.setItem('ritmiq:device:displayName', displayName); } catch {}
      const r = await fetch(`${baseUrl}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          display_name: displayName,
          supabase_user_id: supabaseUserId,
          pin: newPin,
        }),
      });
      if (!r.ok) throw new Error(`POST /pair fallo ${r.status}`);
      const body = await r.json();
      if (body.status === 'approved' && body.deviceToken) {
        try {
          localStorage.setItem('ritmiq:device:token', body.deviceToken);
          localStorage.setItem('ritmiq:lan:tunnelUrl', baseUrl);
        } catch {}
        setStatus('approved');
        return;
      }
      // Polling.
      setStatus('pending');
      const start = Date.now();
      const poll = async () => {
        if (Date.now() - start > 10 * 60 * 1000) {
          setStatus('error'); setError('Tiempo agotado'); return;
        }
        try {
          const s = await fetch(`${baseUrl}/pair/status?device_id=${encodeURIComponent(deviceId)}`);
          const sb = await s.json();
          if (sb.status === 'approved' && sb.deviceToken) {
            try {
              localStorage.setItem('ritmiq:device:token', sb.deviceToken);
              localStorage.setItem('ritmiq:lan:tunnelUrl', baseUrl);
            } catch {}
            setStatus('approved');
            return;
          }
          if (sb.status === 'rejected') { setStatus('rejected'); return; }
          setTimeout(poll, 2500);
        } catch (err) {
          setTimeout(poll, 5000);
        }
      };
      setTimeout(poll, 2500);
    } catch (err) {
      setStatus('error');
      setError(String(err?.message ?? err));
    }
  };

  const onUnpair = () => {
    if (!confirm('Desconectar este dispositivo del desktop?')) return;
    try {
      localStorage.removeItem('ritmiq:device:token');
    } catch {}
    setStatus('idle');
    setPin(null);
  };

  return (
    <div className={styles.section}>
      <h3>Parear con un desktop</h3>
      <p className={styles.muted}>
        Para reproducir tu biblioteca, parea esta PWA con un desktop que
        este corriendo Ritmiq. Solo el dueno del desktop tiene que aprobar
        una vez por dispositivo.
      </p>

      {existingToken && status !== 'requesting' && status !== 'pending' && (
        <div className={styles.subBlock}>
          <div className={styles.success}>
            Ya estas pareado con un desktop. Si querer cambiar de desktop o
            re-parear, desconectate primero.
          </div>
          <button className={styles.btnSecondary} onClick={onUnpair}>Desconectar</button>
        </div>
      )}

      {!existingToken && (
        <>
          <label className={styles.field}>
            <span>Nombre visible</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Mi iPhone"
            />
          </label>
          <label className={styles.field}>
            <span>URL del tunnel del desktop</span>
            <input
              type="url"
              value={tunnelInput}
              onChange={(e) => setTunnelInput(e.target.value)}
              placeholder="https://ritmiq.org"
            />
          </label>
          <button
            className={styles.btnPrimary}
            disabled={status === 'requesting' || status === 'pending' || !tunnelInput.trim()}
            onClick={onStartPair}
          >
            {status === 'pending' ? 'Esperando aprobacion...' : 'Solicitar pareo'}
          </button>
        </>
      )}

      {pin && status === 'pending' && (
        <div className={styles.subBlock}>
          <div>Mostralre al duenod del desktop:</div>
          <div style={{ fontSize: 36, fontWeight: 600, letterSpacing: 4, fontFamily: 'monospace' }}>
            {pin}
          </div>
          <div className={styles.muted}>Caduca en 10 minutos.</div>
        </div>
      )}

      {status === 'approved' && (
        <div className={styles.success}>Pareo aprobado. Ya podes reproducir.</div>
      )}
      {status === 'rejected' && (
        <div className={styles.error}>El dueno del desktop rechazo la solicitud.</div>
      )}
      {status === 'error' && error && (
        <div className={styles.error}>{error}</div>
      )}
    </div>
  );
}

/**
 * PWA: panel de diagnostico. Muestra el estado actual de la conexion
 * (device_token, tunnel URL, legacy access token) y permite limpiar
 * residuos del modelo viejo. Util cuando algo falla y el user no tiene
 * DevTools.
 */
function PwaDiagnosticsSection() {
  const [state, setState] = useState(null);
  const [testing, setTesting] = useState(false);
  const [pingResult, setPingResult] = useState(null);

  const refresh = () => {
    try {
      const deviceToken = localStorage.getItem('ritmiq:device:token');
      const deviceId = localStorage.getItem('ritmiq:device:id');
      const tunnelUrl = localStorage.getItem('ritmiq:lan:tunnelUrl');
      const lanUrl = localStorage.getItem('ritmiq:lan:baseUrl');
      const legacyAccessToken = localStorage.getItem('ritmiq:lan:accessToken');
      setState({
        deviceToken: deviceToken ? `${deviceToken.slice(0, 8)}…${deviceToken.slice(-4)}` : null,
        deviceTokenLen: deviceToken?.length ?? 0,
        deviceId,
        tunnelUrl,
        lanUrl,
        legacyAccessToken: legacyAccessToken ? `${legacyAccessToken.slice(0, 8)}…` : null,
      });
    } catch (e) {
      setState({ error: String(e?.message ?? e) });
    }
  };

  useEffect(() => { refresh(); }, []);

  const onClearLegacy = () => {
    if (!confirm('Limpiar token de acceso legacy? Esto solo afecta al modelo viejo, NO al pareo actual.')) return;
    try {
      localStorage.removeItem('ritmiq:lan:accessToken');
    } catch {}
    refresh();
  };

  const onClearAll = () => {
    if (!confirm('Borrar TODA la configuracion de pareo? Vas a tener que re-parear.')) return;
    try {
      localStorage.removeItem('ritmiq:device:token');
      localStorage.removeItem('ritmiq:device:id');
      localStorage.removeItem('ritmiq:device:displayName');
      localStorage.removeItem('ritmiq:lan:tunnelUrl');
      localStorage.removeItem('ritmiq:lan:accessToken');
    } catch {}
    refresh();
  };

  const onTestPing = async () => {
    setTesting(true);
    setPingResult(null);
    try {
      const base = state?.tunnelUrl?.replace(/\/$/, '') ?? '';
      if (!base) throw new Error('Sin tunnel URL configurada');
      // Test /health (no auth)
      const t0 = performance.now();
      const r1 = await fetch(`${base}/health`);
      const dtHealth = Math.round(performance.now() - t0);
      const healthOk = r1.ok;

      // Test que el device_token este aceptado: /yt/prewarm es barato.
      let authStatus = 'sin device_token';
      if (state?.deviceToken) {
        const tok = localStorage.getItem('ritmiq:device:token');
        const r2 = await fetch(`${base}/yt/prewarm?q=dQw4w9WgXcQ&token=${encodeURIComponent(tok)}`);
        authStatus = `HTTP ${r2.status}${r2.status === 204 ? ' (OK)' : ''}`;
      }
      setPingResult({
        ok: healthOk && authStatus.includes('OK'),
        text: `Health: ${healthOk ? 'OK' : 'FALLO'} (${dtHealth}ms) · Auth: ${authStatus}`,
      });
    } catch (err) {
      setPingResult({ ok: false, text: String(err?.message ?? err) });
    } finally {
      setTesting(false);
    }
  };

  if (!state) return null;

  return (
    <div className={styles.section}>
      <h3>Diagnostico de conexion</h3>
      <p className={styles.muted}>
        Estado actual de tu pareo con el desktop. Util si algo no funciona.
      </p>

      <div className={styles.subBlock} style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7 }}>
        <div>device_id: <strong>{state.deviceId || '(no generado)'}</strong></div>
        <div>device_token: <strong>{state.deviceToken ? `${state.deviceToken} (${state.deviceTokenLen} chars)` : '(no pareado)'}</strong></div>
        <div>tunnel URL: <strong>{state.tunnelUrl || '(no configurada)'}</strong></div>
        <div>LAN local: <strong>{state.lanUrl || '(no configurada)'}</strong></div>
        <div style={{ color: state.legacyAccessToken ? 'orange' : undefined }}>
          legacy access-token: <strong>{state.legacyAccessToken || '(no presente — bien)'}</strong>
        </div>
      </div>

      {state.legacyAccessToken && (
        <div className={styles.subBlock}>
          <div className={styles.muted} style={{ color: 'orange' }}>
            Tenes un token legacy guardado. Si pareaste con Modelo Y, este token NO se usa
            (prioriza device_token) pero puede confundir el flow. Recomendado: limpiarlo.
          </div>
          <button className={styles.btnSecondary} onClick={onClearLegacy}>Limpiar legacy token</button>
        </div>
      )}

      <div className={styles.subBlock}>
        <button
          className={styles.btnPrimary}
          onClick={onTestPing}
          disabled={testing || !state.tunnelUrl}
        >
          {testing ? 'Probando…' : 'Probar conexion'}
        </button>
        {pingResult && (
          <div className={pingResult.ok ? styles.success : styles.error}>
            {pingResult.text}
          </div>
        )}
      </div>

      <div className={styles.subBlock}>
        <button className={styles.btnSecondary} onClick={onClearAll}>
          Borrar todo el pareo (re-parear)
        </button>
      </div>
    </div>
  );
}
