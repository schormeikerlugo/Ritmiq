/**
 * Seccion Diagnostico \u2014 muestra el estado de las APIs criticas de la
 * PWA (Notification, Service Worker, Push Manager, permisos, modo de
 * display, VAPID key, suscripcion activa, sesion).
 *
 * Util para:
 *   - Diagnosticar por que un toggle no aparece (caso real reportado:
 *     iOS PWA donde 'Notificaciones' no salia en Ajustes).
 *   - Verificar que la PWA esta correctamente instalada antes de
 *     activar features dependientes (Push, Badge, Wake Lock).
 *   - Reportes de bugs futuros \u2014 el usuario puede leer estos 8
 *     valores y pasarmelos sin necesidad de un Mac conectado.
 *
 * Re-evaluacion automatica:
 *   - Al mount.
 *   - Al focus de la ventana.
 *   - Al visibilitychange visible (PWA standalone no dispara focus).
 *   - Tras 500ms del mount (margen iOS PWA \u2014 las APIs Push pueden
 *     tardar en estar disponibles).
 *   - Manualmente con el boton 'Forzar re-evaluacion'.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/DiagnosticsSection
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '../../../stores/auth.js';
import { streamOriginCounts, lastStreamOrigin, metaPublishStats } from '../../../lib/use-player.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';
import styles from './DiagnosticsSection.module.css';

/** Etiquetas legibles para cada origen del cascade de resolveAudioSource. */
const ORIGIN_LABELS = {
  'local-file':        'Local (descargado)',
  'local-blob':        'Local (IndexedDB)',
  'lan':               'LAN propio',
  'cache-global-url':  'Cache global Ritmiq',
  'cloud-stream':      'Cloud (yt-dlp)',
};

export function DiagnosticsSection() {
  const user = useAuthStore((s) => s.user);
  const [diag, setDiag] = useState(() => readDiagnostics());
  const [cacheTestResult, setCacheTestResult] = useState(null);

  // Re-leer las flags en triggers que pueden cambiar el estado.
  useEffect(() => {
    const recheck = async () => setDiag(await readDiagnosticsAsync());
    const onVisibility = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', onVisibility);
    // Re-check tardio: iOS PWA puede exponer APIs con delay.
    const t = setTimeout(recheck, 500);
    // Tambien leer la suscripcion (async) tras mount.
    recheck();
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(t);
    };
  }, []);

  async function handleRefresh() {
    setDiag(await readDiagnosticsAsync());
  }

  // userId: trunco a 8 chars + ... para privacidad en screenshots.
  const userIdShort = user?.id
    ? `${user.id.slice(0, 8)}\u2026`
    : 'sin sesion';

  return (
    <SettingsGroup title="Diagnostico">
      <SettingRow
        label="Notification API"
        description="Permite mostrar notificaciones del sistema operativo."
        control={<FlagBadge ok={diag.hasNotification} okLabel="disponible" failLabel="no soportado" />}
      />
      <SettingRow
        label="Service Worker"
        description={
          diag.hasServiceWorker
            ? (diag.swScope ? `Registrado en ${diag.swScope}` : 'Soportado pero no registrado')
            : 'No soportado. Requiere HTTPS o localhost.'
        }
        control={<FlagBadge ok={diag.hasServiceWorker && !!diag.swScope} okLabel="activo" failLabel="no activo" />}
      />
      <SettingRow
        label="Push Manager"
        description={
          diag.hasPushManager
            ? 'Disponible. La PWA puede recibir notificaciones push.'
            : 'No expuesto. En iOS, requiere instalar la PWA via Compartir > Anadir a pantalla de inicio.'
        }
        control={<FlagBadge ok={diag.hasPushManager} okLabel="disponible" failLabel="no expuesto" />}
      />
      <SettingRow
        label="Permiso de notificaciones"
        description={permissionDescription(diag.permission)}
        control={<PermissionBadge value={diag.permission} />}
      />
      <SettingRow
        label="Modo de display"
        description={
          diag.displayMode === 'standalone'
            ? 'PWA instalada en pantalla de inicio.'
            : diag.displayMode === 'fullscreen'
              ? 'Modo fullscreen (sin chrome del navegador).'
              : 'Pestana del navegador (no instalada como PWA).'
        }
        control={<FlagBadge ok={diag.displayMode === 'standalone' || diag.displayMode === 'fullscreen'} okLabel={diag.displayMode} failLabel={diag.displayMode} />}
      />
      <SettingRow
        label="VAPID key"
        description={
          diag.hasVapid
            ? 'Configurada \u2014 el cliente puede suscribirse a push.'
            : 'Vacia. Configura VITE_VAPID_PUBLIC_KEY en Vercel > Settings > Environment Variables y redeploya.'
        }
        control={<FlagBadge ok={diag.hasVapid} okLabel="configurada" failLabel="vacia" />}
      />
      <SettingRow
        label="Supabase URL"
        description={
          diag.hasSupabaseUrl
            ? 'Configurada.'
            : 'Vacia. Configura VITE_SUPABASE_URL en Vercel.'
        }
        control={<FlagBadge ok={diag.hasSupabaseUrl} okLabel="configurada" failLabel="vacia" />}
      />
      <SettingRow
        label="Supabase anon key"
        description={
          diag.hasSupabaseKey
            ? 'Configurada.'
            : 'Vacia. Configura VITE_SUPABASE_ANON_KEY en Vercel.'
        }
        control={<FlagBadge ok={diag.hasSupabaseKey} okLabel="configurada" failLabel="vacia" />}
      />
      <SettingRow
        label="Suscripcion push activa"
        description={
          diag.subscriptionEndpoint
            ? `Endpoint: ${truncateEndpoint(diag.subscriptionEndpoint)}`
            : 'Ninguna. Activa notificaciones en Cuenta para suscribirte.'
        }
        control={<FlagBadge ok={!!diag.subscriptionEndpoint} okLabel="suscrito" failLabel="ninguna" />}
      />
      <SettingRow
        label="Sesion Supabase"
        description={user?.email ?? 'Sin sesion activa. Inicia sesion para acceder a features sociales.'}
        control={<span className={styles.value}>{userIdShort}</span>}
      />

      <SettingRow
        label="Cache global de URLs (Fase 1)"
        description={cacheTestResult ?? 'Toca Probar para hacer un lookup de un ytId conocido contra Supabase Edge.'}
        control={<LinkButton onClick={() => testCacheLookup(setCacheTestResult)}>Probar</LinkButton>}
      />

      <StreamOriginsRow />

      <TracksGlobalRow />

      <SettingRow
        label="Forzar re-evaluacion"
        description="Re-lee todas las flags. Util si iOS expuso APIs con delay tras instalar la PWA."
        control={<LinkButton onClick={handleRefresh}>Refrescar</LinkButton>}
      />
    </SettingsGroup>
  );
}

/**
 * Lanza un GET /get-stream-url con un ytId conocido para verificar que
 * la Edge Function esta deployada y responde. Reporta HIT/MISS/ERROR.
 */
async function testCacheLookup(setResult) {
  const sup = import.meta.env.VITE_SUPABASE_URL;
  if (!sup) { setResult('VITE_SUPABASE_URL no configurado'); return; }
  setResult('Probando...');
  try {
    const { supabase } = await import('../../../lib/supabase.js');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setResult('Sin sesion Supabase'); return; }
    // Track de prueba: ytId publico cualquiera. Cualquier resultado nos
    // dice si la Edge responde (HIT 200, MISS 404, otro = error).
    const testYtId = 'dQw4w9WgXcQ';
    const t0 = performance.now();
    const r = await fetch(
      `${sup}/functions/v1/get-stream-url?ytId=${encodeURIComponent(testYtId)}`,
      { headers: { Authorization: `Bearer ${session.access_token}` } }
    );
    const dt = Math.round(performance.now() - t0);
    if (r.status === 200) {
      const body = await r.json();
      setResult(`HIT en ${dt}ms — source=${body?.source ?? '?'}`);
    } else if (r.status === 404) {
      setResult(`MISS en ${dt}ms — Edge responde, cache vacio para ${testYtId}`);
    } else {
      const text = await r.text().catch(() => '');
      setResult(`HTTP ${r.status} en ${dt}ms — ${text.slice(0, 80)}`);
    }
  } catch (err) {
    setResult(`Error: ${err?.message ?? String(err)}`);
  }
}

// ── Subcomponentes ──────────────────────────────────────────────────

/**
 * Tabla compacta con cuantas reproducciones de la sesion actual se
 * sirvieron desde cada origen del cascade. Hace tangible el beneficio
 * del cache global: si el usuario ve un 5/12 desde "Cache global Ritmiq"
 * entiende que esta ahorrando llamadas a yt-dlp tanto suyas como ajenas.
 *
 * Polling cada 3s mientras esta visible. Los datos son in-memory en
 * use-player.js — al reiniciar la app se ponen a cero.
 */
function StreamOriginsRow() {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 3_000);
    return () => clearInterval(id);
  }, []);

  const entries = Object.entries(streamOriginCounts);
  const total = entries.reduce((acc, [, v]) => acc + v, 0);
  const last = lastStreamOrigin.origin
    ? `${ORIGIN_LABELS[lastStreamOrigin.origin] ?? lastStreamOrigin.origin}`
    : 'aun ninguna';

  const desc = total === 0
    ? `Aun no se ha reproducido nada en esta sesion. Cuando suene una cancion, aqui veras de donde vino.`
    : `${total} ${total === 1 ? 'reproduccion' : 'reproducciones'} esta sesion · ultima: ${last}`;

  return (
    <SettingRow
      label="Origenes de stream (esta sesion)"
      description={desc}
      control={
        total > 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontSize: 'var(--fs-xs)',
            fontVariantNumeric: 'tabular-nums',
            alignItems: 'flex-end',
            minWidth: 160,
          }}>
            {entries
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--color-text-3)' }}>
                    {ORIGIN_LABELS[k] ?? k}
                  </span>
                  <span style={{
                    color: k === 'cache-global-url'
                      ? 'var(--color-accent)'
                      : 'var(--color-text-1)',
                    fontWeight: 600,
                    minWidth: 24,
                    textAlign: 'right',
                  }}>
                    {v}
                  </span>
                </div>
              ))}
          </div>
        ) : null
      }
    />
  );
}

/**
 * Fila "Diccionario global Ritmiq" — la Fase tracks_global.
 *
 * Muestra:
 *   - Cuantas canciones conoce la red Ritmiq (count agregado publico).
 *   - Mis contribuciones de la sesion actual (in-memory).
 *   - Boton "Probar busqueda" que hace una consulta de prueba a
 *     search-youtube con `?known=1` para validar que el paso 0 del
 *     Edge esta retornando known items correctamente.
 *
 * El count se refresca cada 30s (no critico de tiempo real).
 */
function TracksGlobalRow() {
  const [count, setCount] = useState(null);
  const [, force] = useState(0);
  const [testMsg, setTestMsg] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const { supabase } = await import('../../../lib/supabase.js');
        const { count: c, error } = await supabase
          .from('tracks_global')
          .select('yt_id', { count: 'exact', head: true });
        if (!cancelled && !error) setCount(c ?? 0);
      } catch { /* tabla no existe aun o sin red */ }
    }
    refresh();
    const id = setInterval(refresh, 30_000);
    const id2 = setInterval(() => force((n) => n + 1), 5_000); // refresca stats local
    return () => { cancelled = true; clearInterval(id); clearInterval(id2); };
  }, []);

  async function handleTest() {
    setTesting(true);
    setTestMsg(null);
    const t0 = performance.now();
    try {
      const sup = import.meta.env.VITE_SUPABASE_URL;
      const apikey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!sup || !apikey) throw new Error('Falta VITE_SUPABASE_URL/KEY');
      // Query generica "music" — deberia matchear casi cualquier track.
      const r = await fetch(
        `${sup}/functions/v1/search-youtube?q=music&type=videos&max=1`,
        { headers: { Authorization: `Bearer ${apikey}`, apikey } }
      );
      const dt = Math.round(performance.now() - t0);
      if (!r.ok) {
        setTestMsg(`HTTP ${r.status} (${dt} ms)`);
      } else {
        const body = await r.json();
        const knownN = (body?.known ?? []).length;
        setTestMsg(`OK ${dt}ms — ${knownN} known + ${body?.items?.length ?? 0} de YouTube`);
      }
    } catch (err) {
      setTestMsg(`Error: ${err?.message ?? err}`);
    } finally {
      setTesting(false);
    }
  }

  const localStats = metaPublishStats;
  const detailParts = [];
  if (count !== null) detailParts.push(`${count} canciones canonizadas`);
  else detailParts.push('cargando count...');
  if (localStats.successes > 0) detailParts.push(`mis contribuciones: ${localStats.successes}`);
  if (localStats.failures > 0) detailParts.push(`fallos: ${localStats.failures}`);
  if (testMsg) detailParts.push(testMsg);

  return (
    <SettingRow
      label="Diccionario global Ritmiq (Fase 2)"
      description={detailParts.join(' · ')}
      control={<LinkButton onClick={handleTest} disabled={testing}>{testing ? '...' : 'Probar'}</LinkButton>}
    />
  );
}

function FlagBadge({ ok, okLabel, failLabel }) {
  return (
    <span className={styles.badge} data-ok={ok || undefined}>
      <span aria-hidden="true">{ok ? '\u2713' : '\u2717'}</span>
      <span>{ok ? okLabel : failLabel}</span>
    </span>
  );
}

function PermissionBadge({ value }) {
  // Colores semanticos: granted=verde, denied=rojo, default=gris.
  const variant = value === 'granted' ? 'ok'
                : value === 'denied'  ? 'fail'
                : 'neutral';
  return (
    <span className={styles.badge} data-variant={variant}>
      <span>{value ?? 'unknown'}</span>
    </span>
  );
}

// ── Helpers de lectura ──────────────────────────────────────────────

function readDiagnostics() {
  // Version sincrona: lee lo que se puede sin promises (todo excepto
  // la suscripcion activa de pushManager).
  if (typeof window === 'undefined') {
    return {
      hasNotification: false,
      hasServiceWorker: false,
      hasPushManager: false,
      permission: null,
      displayMode: 'browser',
      hasVapid: false,
      hasSupabaseUrl: false,
      hasSupabaseKey: false,
      swScope: null,
      subscriptionEndpoint: null,
    };
  }
  return {
    hasNotification: 'Notification' in window,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager:   'PushManager' in window,
    permission:       'Notification' in window ? Notification.permission : null,
    displayMode:      detectDisplayMode(),
    hasVapid:         !!import.meta.env.VITE_VAPID_PUBLIC_KEY,
    hasSupabaseUrl:   !!import.meta.env.VITE_SUPABASE_URL,
    hasSupabaseKey:   !!import.meta.env.VITE_SUPABASE_ANON_KEY,
    swScope:          null,
    subscriptionEndpoint: null,
  };
}

async function readDiagnosticsAsync() {
  const base = readDiagnostics();

  // SW scope: requiere await sobre getRegistration().
  if (base.hasServiceWorker) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        base.swScope = reg.scope.replace(window.location.origin, '') || '/';
        // Suscripcion activa.
        if (base.hasPushManager) {
          const sub = await reg.pushManager.getSubscription();
          base.subscriptionEndpoint = sub?.endpoint ?? null;
        }
      }
    } catch {
      // Silencioso \u2014 el diagnostico no debe romper si falla.
    }
  }
  return base;
}

function detectDisplayMode() {
  if (typeof window === 'undefined') return 'browser';
  // iOS Safari legacy flag (sigue siendo el unico mecanismo fiable
  // en iOS para distinguir standalone, segun WebKit blog).
  if (window.navigator?.standalone === true) return 'standalone';
  if (window.matchMedia?.('(display-mode: fullscreen)').matches) return 'fullscreen';
  if (window.matchMedia?.('(display-mode: standalone)').matches) return 'standalone';
  if (window.matchMedia?.('(display-mode: minimal-ui)').matches) return 'minimal-ui';
  return 'browser';
}

function permissionDescription(p) {
  if (p === 'granted') return 'Concedido. La PWA puede mostrar notificaciones.';
  if (p === 'denied')  return 'Denegado. Revisa Ajustes iOS/Android > Notificaciones > Ritmiq.';
  if (p === 'default') return 'No solicitado todavia. Activa desde Cuenta > Notificaciones.';
  return 'Desconocido.';
}

function truncateEndpoint(endpoint) {
  // Endpoints son URLs largas (web.push.apple.com/..., fcm.googleapis.com/...).
  // Mostramos host + primeros 12 chars del path + ... + ultimos 8.
  try {
    const url = new URL(endpoint);
    const path = url.pathname;
    if (path.length <= 24) return `${url.host}${path}`;
    return `${url.host}${path.slice(0, 12)}\u2026${path.slice(-8)}`;
  } catch {
    return endpoint.slice(0, 32) + '\u2026';
  }
}
