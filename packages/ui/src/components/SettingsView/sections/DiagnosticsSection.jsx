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
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';
import styles from './DiagnosticsSection.module.css';

export function DiagnosticsSection() {
  const user = useAuthStore((s) => s.user);
  const [diag, setDiag] = useState(() => readDiagnostics());

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
            : 'Vacia en el build. Sin esto Push no funciona aunque haya soporte.'
        }
        control={<FlagBadge ok={diag.hasVapid} okLabel="configurada" failLabel="vacia" />}
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
        label="Forzar re-evaluacion"
        description="Re-lee todas las flags. Util si iOS expuso APIs con delay tras instalar la PWA."
        control={<LinkButton onClick={handleRefresh}>Refrescar</LinkButton>}
      />
    </SettingsGroup>
  );
}

// ── Subcomponentes ──────────────────────────────────────────────────

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
