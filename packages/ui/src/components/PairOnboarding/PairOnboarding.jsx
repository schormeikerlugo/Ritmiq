import { useEffect, useRef, useState } from 'react';
import {
  getDeviceId, getDisplayName, setDisplayName,
  setDeviceToken, setPairedBaseUrl, generatePin,
  postPair, getPairStatus,
} from '../../lib/device.js';
import { pingLan, setLanBaseUrl, setTunnelUrl, listAvailableDesktops } from '../../lib/lan-client.js';
import { supabase } from '../../lib/supabase.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './PairOnboarding.module.css';

/**
 * Flujo de pareo en 4 pasos:
 *   1. Pedir URL del desktop (manual o auto-scan LAN).
 *   2. Validar /health.
 *   3. POST /pair con device_id + PIN + nombre + supabase user.
 *   4. Polling /pair/status hasta approved | rejected | timeout.
 *
 * @param {{ onPaired: (info: { baseUrl: string, deviceToken: string }) => void, onClose: () => void }} props
 */
export function PairOnboarding({ onPaired, onClose }) {
  const [step, setStep] = useState('url'); // 'url'|'pairing'|'waiting'|'done'|'error'
  const [baseUrl, setBaseUrlInput] = useState('');
  const [displayName, setDisplayNameInput] = useState(getDisplayName());
  const [pin, setPin] = useState(null);
  const [errMsg, setErrMsg] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [available, setAvailable] = useState([]);
  const pollTimer = useRef(null);

  useEffect(() => {
    listAvailableDesktops().then(setAvailable).catch(() => {});
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, []);

  const onTestAndPair = async () => {
    setErrMsg(null);
    const url = normalize(baseUrl);
    if (!url) { setErrMsg('URL invalida'); return; }
    setStep('pairing');
    const ok = await pingLan(url, 4000);
    if (!ok) {
      setErrMsg('No se pudo alcanzar la URL. Verifica que el desktop este corriendo.');
      setStep('url');
      return;
    }
    try {
      const deviceId = getDeviceId();
      const myPin = generatePin();
      setPin(myPin);
      const { data: { session } } = await supabase.auth.getSession();
      const r = await postPair(url, {
        deviceId,
        displayName: displayName.trim() || 'Dispositivo',
        supabaseUserId: session?.user?.id ?? null,
        pin: myPin,
      });
      setDisplayName(displayName.trim() || null);
      if (r.status === 'approved' && r.device_token) {
        completePairing(url, r.device_token);
        return;
      }
      // pending → polling
      setStep('waiting');
      startPolling(url, deviceId);
    } catch (err) {
      setErrMsg(err.message ?? String(err));
      setStep('url');
    }
  };

  const startPolling = (url, deviceId) => {
    let elapsed = 0;
    const TIMEOUT_MS = 10 * 60 * 1000;
    pollTimer.current = setInterval(async () => {
      elapsed += 2500;
      if (elapsed >= TIMEOUT_MS) {
        clearInterval(pollTimer.current);
        setErrMsg('La solicitud expiro (10 min). Vuelve a intentar.');
        setStep('url');
        return;
      }
      try {
        const s = await getPairStatus(url, deviceId);
        if (s.status === 'approved' && s.device_token) {
          clearInterval(pollTimer.current);
          completePairing(url, s.device_token);
        } else if (s.status === 'rejected') {
          clearInterval(pollTimer.current);
          setErrMsg('La solicitud fue rechazada o expiro.');
          setStep('url');
        }
      } catch { /* ignore transient errors */ }
    }, 2500);
  };

  const completePairing = (url, token) => {
    setDeviceToken(token);
    setPairedBaseUrl(url);
    // Tambien actualizamos los stores de LAN para que el resto de la app
    // sepa donde apuntar sin esperar a un reload.
    const isPrivate = /^(http:\/\/(localhost|127\.|10\.|192\.168\.|172\.))/.test(url);
    if (isPrivate) setLanBaseUrl(url);
    else setTunnelUrl(url);
    setStep('done');
    onPaired?.({ baseUrl: url, deviceToken: token });
  };

  const onAutoScan = async () => {
    setScanning(true);
    setScanProgress(0);
    const subnets = [
      '192.168.0', '192.168.1', '192.168.68', '192.168.86',
      '192.168.100', '10.0.0', '10.0.1',
    ];
    const ips = [];
    for (const s of subnets) for (let i = 1; i < 255; i++) ips.push(`${s}.${i}`);
    let found = null;
    let done = 0;
    const workers = 30;
    let cursor = 0;
    const worker = async () => {
      while (cursor < ips.length && !found) {
        const ip = ips[cursor++];
        const ok = await pingLan(`http://${ip}:3939`, 250);
        done++;
        setScanProgress(Math.round((done / ips.length) * 100));
        if (ok && !found) { found = `http://${ip}:3939`; break; }
      }
    };
    await Promise.all(Array.from({ length: workers }, worker));
    setScanning(false);
    if (found) setBaseUrlInput(found);
    else setErrMsg('No encontre desktop en LAN. Pega la URL manualmente.');
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>Conectar con un Ritmiq Desktop</h2>
          <button className={styles.close} onClick={onClose} aria-label="Cerrar">
            <Icon name="X" size={18} />
          </button>
        </header>

        {step === 'url' && (
          <>
            <p className={styles.hint}>
              Para reproducir musica y descargar canciones necesitas un
              desktop Ritmiq corriendo. Pega la URL (LAN local o
              Cloudflare Tunnel) o auto-detecta en tu red.
            </p>
            <label className={styles.label}>Nombre de este dispositivo</label>
            <input
              className={styles.input}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayNameInput(e.target.value)}
              placeholder="iPhone de Ana"
              maxLength={80}
            />

            {available.length > 0 && (
              <>
                <label className={styles.label} style={{ marginTop: '0.75rem' }}>
                  Desktops disponibles para ti
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                  {available.map((d) => (
                    <button
                      key={d.owner_user_id}
                      type="button"
                      className={styles.btnSecondary}
                      style={{ textAlign: 'left', height: 'auto', padding: '8px 12px' }}
                      onClick={() => setBaseUrlInput(d.tunnel_url)}
                    >
                      📡 {d.display_name} · <code style={{ fontSize: '0.7rem' }}>{d.tunnel_url}</code>
                    </button>
                  ))}
                </div>
              </>
            )}

            <label className={styles.label} style={{ marginTop: '0.75rem' }}>
              Direccion del desktop
            </label>
            <input
              className={styles.input}
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrlInput(e.target.value)}
              placeholder="https://ritmiq.tudominio.com  o  http://192.168.1.50:3939"
              disabled={scanning}
            />
            {scanning && (
              <div className={styles.scanBar}>
                <div className={styles.scanFill} style={{ width: `${scanProgress}%` }} />
              </div>
            )}
            {errMsg && <p className={styles.status} data-ok={false}>{errMsg}</p>}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={onAutoScan}
                disabled={scanning}
              >{scanning ? `Buscando ${scanProgress}%…` : 'Auto-detectar LAN'}</button>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={onTestAndPair}
                disabled={scanning || !baseUrl.trim() || !displayName.trim()}
              >Conectar</button>
            </div>
          </>
        )}

        {step === 'pairing' && (
          <p className={styles.status} data-ok>Conectando…</p>
        )}

        {step === 'waiting' && (
          <>
            <p className={styles.hint}>
              Solicitud enviada. Espera a que el dueño del desktop te apruebe.
              En su pantalla aparecera una notificacion con el siguiente PIN
              — verifica que coincida con el de abajo.
            </p>
            <div className={styles.pinBox}>
              <div className={styles.pinLabel}>PIN</div>
              <div className={styles.pin}>{pin}</div>
            </div>
            <p className={styles.hint} style={{ textAlign: 'center', opacity: 0.7 }}>
              Esperando aprobacion… (caduca en 10 min)
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  if (pollTimer.current) clearInterval(pollTimer.current);
                  setStep('url');
                }}
              >Cancelar</button>
            </div>
          </>
        )}

        {step === 'done' && (
          <p className={styles.status} data-ok>✓ Conectado correctamente.</p>
        )}
      </div>
    </div>
  );
}

function normalize(s) {
  let u = (s ?? '').trim();
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = `http://${u}`;
  try {
    const parsed = new URL(u);
    if (!parsed.port && parsed.protocol === 'http:') parsed.port = '3939';
    return parsed.origin;
  } catch { return u.replace(/\/$/, ''); }
}
