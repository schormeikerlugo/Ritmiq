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
import { useSocialStore } from '../../../stores/social.js';
import { useViewStore } from '../../../stores/view.js';
import { requestPushPermissionAndRegister, unregisterPush } from '../../../lib/use-push.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';
import { EditProfileDialog } from '../../EditProfileDialog/EditProfileDialog.jsx';
import { Icon } from '../../Icon/Icon.jsx';
import accountStyles from './AccountSection.module.css';

export function AccountSection() {
  const user = useAuthStore((s) => s.user);
  const profile = useSocialStore((s) => s.profile);
  const setSubview = useViewStore((s) => s.setSettingsSubview);
  const [editOpen, setEditOpen] = useState(false);

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

  const displayName = profile?.displayName ?? profile?.username ?? '';
  const initial = (displayName || user?.email || '?').slice(0, 1).toUpperCase();

  return (
    <SettingsGroup title="Cuenta">
      {/* Hero row clickable: avatar + nombre + boton Editar perfil
          siempre visible. En desktop y mobile, el usuario tiene acceso
          directo al modal de edicion sin tener que entrar a subview. */}
      {user && (
        <div className={accountStyles.profileRow}>
          {profile?.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              className={accountStyles.avatar}
            />
          ) : (
            <div className={accountStyles.avatarInitial}>{initial}</div>
          )}
          <div className={accountStyles.profileMeta}>
            <span className={accountStyles.displayName}>
              {displayName || <span className={accountStyles.muted}>Sin nombre</span>}
            </span>
            <span className={accountStyles.handleOrEmail}>
              {profile?.username ? `@${profile.username}` : (user.email ?? '')}
            </span>
          </div>
          <button
            type="button"
            className={accountStyles.editBtn}
            onClick={() => setEditOpen(true)}
            aria-label="Editar perfil"
          >
            <Icon name="Pencil" size={14} />
            <span>Editar</span>
          </button>
        </div>
      )}

      <SettingRow
        label="Correo electronico"
        description={user?.email ?? 'Sin sesion'}
        control={<LinkButton onClick={() => setSubview('account')}>Ver detalles</LinkButton>}
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

      {editOpen && <EditProfileDialog onClose={() => setEditOpen(false)} />}
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
