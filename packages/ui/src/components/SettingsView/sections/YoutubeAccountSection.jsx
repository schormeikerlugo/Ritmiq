/**
 * Sección "Usar mi cuenta de YouTube" (PWA).
 *
 * Permite al usuario subir su propio `cookies.txt` (formato Netscape) para
 * que el servidor resuelva/descargue con SU cuenta de YouTube en vez de la
 * del dueño. Requiere estar pareado con el servidor (device_token).
 *
 * Sub-fase 3a: subida manual del archivo. La vinculación por login headless
 * (noVNC) llegará en 3b.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/YoutubeAccountSection
 */
import { useEffect, useRef, useState } from 'react';
import {
  getServerUrlSync, getTunnelUrlSync, getLanBaseUrlSync,
} from '../../../lib/lan-client.js';
import {
  uploadCookiesTxt, isPaired,
  startYoutubeLink, getYoutubeLinkStatus, unlinkYoutube,
} from '../../../lib/device.js';
import { Button } from '../../primitives/index.js';
import { toast } from '../../../stores/toast.js';
import styles from '../SettingsView.module.css';

/** Base URL preferido para hablar con el servidor (server 24/7 > túnel > LAN). */
function preferredBase() {
  return getServerUrlSync() || getTunnelUrlSync() || getLanBaseUrlSync() || '';
}

export function YoutubeAccountSection() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const paired = isPaired();
  const base = preferredBase();

  const onPickFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.onerror = () => toast.error('No se pudo leer el archivo.');
    reader.readAsText(file);
  };

  const onUpload = async () => {
    if (!base) { toast.error('Primero conéctate al servidor (Acceso remoto).'); return; }
    if (!paired) { toast.error('Este dispositivo no está pareado con el servidor.'); return; }
    setBusy(true);
    try {
      await uploadCookiesTxt(base, text);
      toast.success('Cuenta de YouTube vinculada', { icon: 'CheckCircle2' });
      setText('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      toast.error(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  // ── Login por navegador (noVNC) ──────────────────────────────────────
  const [linking, setLinking] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  /** Construye la URL noVNC a partir del host del servidor + puerto. */
  const novncUrl = (port) => {
    try {
      const u = new URL(base);
      return `${u.protocol}//${u.hostname}:${port}/vnc.html?autoconnect=1&resize=remote`;
    } catch { return null; }
  };

  const onBrowserLink = async () => {
    if (!base) { toast.error('Primero conéctate al servidor (Acceso remoto).'); return; }
    if (!paired) { toast.error('Este dispositivo no está pareado con el servidor.'); return; }
    setLinking(true);
    try {
      const { novncPort } = await startYoutubeLink(base);
      const url = novncUrl(novncPort);
      if (url) window.open(url, '_blank', 'noopener');
      toast.show({ message: 'Abre la ventana, inicia sesión en YouTube y espera…', icon: 'ExternalLink' });
      // Polling del estado hasta linked/expired.
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const st = await getYoutubeLinkStatus(base);
          if (st.status === 'linked') {
            clearInterval(pollRef.current); pollRef.current = null;
            setLinking(false);
            toast.success('Cuenta de YouTube vinculada', { icon: 'CheckCircle2' });
          } else if (st.status === 'expired' || st.status === 'error' || st.status === 'idle') {
            clearInterval(pollRef.current); pollRef.current = null;
            setLinking(false);
            toast.error('El login no se completó a tiempo. Inténtalo de nuevo.');
          }
        } catch { /* seguir intentando */ }
      }, 4000);
    } catch (err) {
      setLinking(false);
      toast.error(String(err?.message ?? err));
    }
  };

  const onUnlink = async () => {
    if (!base) return;
    try {
      await unlinkYoutube(base);
      toast.show({ message: 'Cuenta de YouTube desvinculada', icon: 'X' });
    } catch (err) {
      toast.error(String(err?.message ?? err));
    }
  };

  return (
    <div className={styles.embed}>
      <p style={{ color: 'var(--color-text-2)', fontSize: 'var(--fs-sm)' }}>
        Sube tu <strong>cookies.txt</strong> de YouTube para que el servidor
        reproduzca con <strong>tu cuenta</strong>. Si no lo haces, se usan las
        cookies del dueño del servidor.
      </p>

      <div
        style={{
          background: 'var(--color-bg-2)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3)',
          margin: 'var(--space-2) 0',
          fontSize: 'var(--fs-sm)',
          color: 'var(--color-text-2)',
        }}
      >
        <strong>Recomendación de seguridad:</strong> usa una cuenta de YouTube
        <strong> sin verificación en dos pasos (2FA)</strong> o una cuenta
        secundaria que uses poco. Las cookies dan acceso a tu sesión, y una
        cuenta con 2FA puede invalidarlas o bloquearse con más frecuencia.
      </div>

      {/* Opción A (recomendada): login por navegador remoto (noVNC). */}
      <div style={{ margin: 'var(--space-3) 0' }}>
        <div style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-sm)', marginBottom: '4px' }}>
          Opción A — Iniciar sesión en el navegador del servidor
        </div>
        <p style={{ color: 'var(--color-text-2)', fontSize: 'var(--fs-sm)', margin: '0 0 var(--space-2)' }}>
          Se abre una ventana con un navegador del servidor. Inicia sesión en
          YouTube ahí; el servidor captura tus cookies automáticamente.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Button variant="primary" size="sm" onClick={onBrowserLink} loading={linking} loadingText="Esperando login…" disabled={!paired}>
            Vincular con navegador
          </Button>
          <Button variant="ghost" size="sm" onClick={onUnlink} disabled={!paired}>
            Desvincular
          </Button>
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--color-border)', margin: 'var(--space-3) 0' }} />

      {/* Opción B: subida manual de cookies.txt. */}
      <div style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-sm)', marginBottom: '4px' }}>
        Opción B — Subir tu cookies.txt manualmente
      </div>
      <ol style={{ paddingLeft: 'var(--space-4)', fontSize: 'var(--fs-sm)', color: 'var(--color-text-2)' }}>
        <li>Instala la extensión «Get cookies.txt LOCALLY» en tu navegador.</li>
        <li>Abre youtube.com con tu sesión iniciada y exporta el cookies.txt.</li>
        <li>Súbelo o pega su contenido aquí abajo.</li>
      </ol>

      <input
        ref={fileRef}
        type="file"
        accept=".txt,text/plain"
        onChange={onPickFile}
        disabled={busy}
        style={{ margin: 'var(--space-2) 0' }}
      />

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="… o pega aquí el contenido de tu cookies.txt (formato Netscape)"
        rows={5}
        disabled={busy}
        spellCheck={false}
        style={{
          width: '100%',
          fontFamily: 'monospace',
          fontSize: '11px',
          background: 'var(--color-bg-1)',
          color: 'var(--color-text-1)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-2)',
          resize: 'vertical',
        }}
      />

      <div style={{ marginTop: 'var(--space-2)' }}>
        <Button
          variant="primary"
          size="sm"
          onClick={onUpload}
          loading={busy}
          loadingText="Subiendo…"
          disabled={!text.trim() || !paired}
        >
          Vincular mi cuenta de YouTube
        </Button>
      </div>

      {!paired && (
        <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--color-danger)' }}>
          Debes parear este dispositivo con el servidor antes de vincular tu cuenta.
        </p>
      )}
    </div>
  );
}
