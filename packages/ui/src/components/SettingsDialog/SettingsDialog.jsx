import { useEffect, useState } from 'react';
import {
  getLanBaseUrlSync, setLanBaseUrl, pingLan,
} from '../../lib/lan-client.js';
import { api, isDesktop } from '../../lib/api.js';
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
          >×</button>
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
