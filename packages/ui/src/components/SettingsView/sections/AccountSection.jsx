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
import { isStandalonePWA, detectPlatform } from '../../../lib/share.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';
import { Toggle } from '../controls/Toggle.jsx';
import { EditProfileDialog } from '../../EditProfileDialog/EditProfileDialog.jsx';
import { IOSInstallHint } from '../../IOSInstallHint/IOSInstallHint.jsx';
import { Icon } from '../../Icon/Icon.jsx';
import accountStyles from './AccountSection.module.css';

export function AccountSection() {
  const user = useAuthStore((s) => s.user);
  const profile = useSocialStore((s) => s.profile);
  const updateProfile = useSocialStore((s) => s.updateProfile);
  const setSubview = useViewStore((s) => s.setSettingsSubview);
  const [editOpen, setEditOpen] = useState(false);

  // Toggle social: "Escuchando ahora" visible para amigos.
  // Ubicado aqui (en Cuenta) junto a Notificaciones porque ambos
  // controlan visibilidad/privacidad social del usuario.
  const showActivity = profile?.showActivity ?? true;

  // ── Web Push state ──────────────────────────────────────────────
  // Detectamos soporte y estado del permiso una vez al montar.
  // Si no hay soporte (desktop Electron, Safari muy viejo, etc.) ocultamos
  // la fila — no tiene sentido ofrecer activacion que va a fallar.
  const [pushState, setPushState] = useState(() => initialPushState());
  const [busy, setBusy] = useState(false);
  // Modal de tutorial para iOS Safari (no standalone). En esa situacion
  // Notification.requestPermission() es no-op silencioso en iOS \u2014
  // tenemos que guiar al usuario a instalar primero.
  const [iosHintOpen, setIosHintOpen] = useState(false);

  // Re-leer el estado del permiso periodicamente. Tres triggers:
  //
  //   1. focus: el usuario pudo cambiar el permiso desde la barra de
  //      URL del navegador y volver a la pestana sin recargar.
  //   2. visibilitychange visible: PWA standalone iOS no dispara focus
  //      al salir de background \u2014 visibilitychange si.
  //   3. timeout 500ms tras mount: iOS PWA 16.4 puede exponer PushManager
  //      con delay tras el primer paint. Sin esto, si initialPushState()
  //      corre antes de que iOS termine de inicializar las APIs, queda
  //      'unsupported' permanentemente \u2014 la fila no aparece nunca.
  //
  // CLAVE: NO usar `if (pushState === 'unsupported') return` aqui. El
  // bug previo era ese return temprano \u2014 una vez 'unsupported', nunca
  // se re-evaluaba. Ahora reevaluamos siempre.
  useEffect(() => {
    const recheck = () => setPushState(initialPushState());
    const onVisibility = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', onVisibility);
    // Re-check tardio para iOS PWA \u2014 las APIs Push pueden tardar
    // ~100-500ms en estar disponibles tras el mount.
    const t = setTimeout(recheck, 500);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(t);
    };
  }, []);

  async function handleEnable() {
    if (!user || busy) return;
    // Pre-check iOS: requestPermission() en Safari iOS no-standalone
    // devuelve 'default' silenciosamente \u2014 el API existe pero no
    // funciona hasta que el usuario instale la PWA. Mostramos tutorial.
    if (detectPlatform() === 'ios' && !isStandalonePWA()) {
      setIosHintOpen(true);
      return;
    }
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

      {/* Notificaciones: mostrar siempre que haya sesion. El control
          varia segun el estado:
            - browser-unsupported: mensaje 'no soportado' (raro).
            - missing-vapid:       mensaje 'falta config servidor' \u2014
              apunta al usuario a Diagnostico para detalles.
            - granted/denied/default: comportamiento normal.
          Antes ocultabamos la fila si pushState === 'unsupported',
          pero eso esconde tambien el caso 'VAPID vacia' \u2014 el usuario
          no sabia por que no podia activar. */}
      {user && (
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
            ) : pushState === 'unsupported' ? (
              // Browser sin APIs Push, o build sin VAPID key. El detalle
              // exacto esta en Ajustes > Diagnostico.
              <LinkButton onClick={() => {}} disabled>No disponible</LinkButton>
            ) : (
              <LinkButton onClick={handleEnable} disabled={busy}>
                {busy ? '...' : 'Activar'}
              </LinkButton>
            )
          }
        />
      )}

      {/* Privacidad social — agrupado con Notificaciones porque ambos
          controlan que comparte el usuario con sus amigos. */}
      {user && (
        <SettingRow
          label="Compartir actividad"
          description="Tus amigos en Ritmiq pueden ver que estas escuchando en tiempo real."
          control={
            <Toggle
              checked={showActivity}
              onChange={(next) => updateProfile({ showActivity: next })}
              ariaLabel="Compartir actividad con amigos"
            />
          }
        />
      )}

      {editOpen && <EditProfileDialog onClose={() => setEditOpen(false)} />}
      {iosHintOpen && <IOSInstallHint onClose={() => setIosHintOpen(false)} />}
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
  if (state === 'unsupported') {
    // Distinguimos los dos motivos posibles para guiar al usuario:
    //   - APIs no expuestas por el navegador (browser viejo, iOS Safari
    //     no instalado, etc.) \u2014 ver Diagnostico.
    //   - VAPID key vacia en el build \u2014 ver Diagnostico.
    return 'No disponible en este dispositivo o falta configuracion del servidor. Ver Ajustes > Diagnostico.';
  }
  return 'Activa para recibir avisos cuando un amigo te comparta musica.';
}
