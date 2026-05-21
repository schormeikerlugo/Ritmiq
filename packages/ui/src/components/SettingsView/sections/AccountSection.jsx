/**
 * Seccion de Cuenta — fila clickable que abre la subvista con info
 * detallada del usuario, mas un boton para activar Web Push
 * notifications para shares/solicitudes de amistad.
 *
 * Patron estilo Spotify: la seccion principal solo muestra el email
 * + chevron. Al hacer click se navega a una "subvista" donde van los
 * controles avanzados (cambiar email, password, eliminar cuenta).
 *
 * @module @ritmiq/ui/components/SettingsView/sections/AccountSection
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '../../../stores/auth.js';
import { useViewStore } from '../../../stores/view.js';
import { requestPushPermissionAndRegister, unregisterPush } from '../../../lib/use-push.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';

export function AccountSection() {
  const user = useAuthStore((s) => s.user);
  const setSubview = useViewStore((s) => s.setSettingsSubview);

  // ── Web Push state ──────────────────────────────────────────────
  // Detectamos soporte y estado del permiso una vez al montar.
  // Si no hay soporte (desktop Electron, Safari muy viejo, etc.) ocultamos
  // la fila — no tiene sentido ofrecer activacion que va a fallar.
  const [pushState, setPushState] = useState(() => initialPushState());
  const [busy, setBusy] = useState(false);

  // Re-leer el estado del permiso cuando volvemos a foco (el usuario pudo
  // cambiarlo en la barra de URL del navegador sin recargar).
  useEffect(() => {
    if (pushState === 'unsupported') return;
    const onFocus = () => setPushState(initialPushState());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [pushState]);

  async function handleEnable() {
    if (!user || busy) return;
    setBusy(true);
    const ok = await requestPushPermissionAndRegister(user.id);
    setBusy(false);
    setPushState(ok ? 'granted' : (Notification.permission === 'denied' ? 'denied' : 'default'));
  }

  async function handleDisable() {
    if (busy) return;
    setBusy(true);
    await unregisterPush();
    setBusy(false);
    setPushState('default');
  }

  return (
    <SettingsGroup title="Cuenta">
      <SettingRow
        label="Iniciar sesion"
        description={user?.email ?? 'Sin sesion'}
        control={<LinkButton onClick={() => setSubview('account')}>Editar</LinkButton>}
      />

      {/* Web Push: solo si hay soporte Y hay sesion activa */}
      {pushState !== 'unsupported' && user && (
        <SettingRow
          label="Notificaciones"
          description={pushDescription(pushState)}
          control={
            pushState === 'granted' ? (
              <LinkButton onClick={handleDisable} disabled={busy}>
                {busy ? '...' : 'Desactivar'}
              </LinkButton>
            ) : pushState === 'denied' ? (
              // Si el usuario las denegio, ya no podemos pedir permiso
              // programaticamente — tiene que cambiarlas en ajustes del SO.
              <LinkButton onClick={() => {}} disabled>Bloqueadas</LinkButton>
            ) : (
              <LinkButton onClick={handleEnable} disabled={busy}>
                {busy ? '...' : 'Activar'}
              </LinkButton>
            )
          }
        />
      )}
    </SettingsGroup>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function initialPushState() {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }
  if (!import.meta.env.VITE_VAPID_PUBLIC_KEY) return 'unsupported';
  return Notification.permission;
}

function pushDescription(state) {
  if (state === 'granted') {
    return 'Recibe notificaciones de solicitudes de amistad y musica compartida.';
  }
  if (state === 'denied') {
    return 'Bloqueadas. Cambia el permiso desde los ajustes de tu navegador.';
  }
  return 'Activa para recibir avisos cuando un amigo te comparta musica.';
}
