/**
 * Subvista de Cuenta — detalle del usuario.
 *
 * Por ahora muestra:
 *   - email
 *   - id (truncado)
 *   - boton Cerrar sesion
 *
 * Placeholders preparados para iteraciones futuras:
 *   - Cambiar contrasena (TODO)
 *   - Eliminar cuenta (TODO)
 *   - Conectar cuenta de Spotify para import automatico (TODO)
 *
 * @module @ritmiq/ui/components/SettingsView/sections/AccountInfoView
 */
import { useAuthStore } from '../../../stores/auth.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';
import { Icon } from '../../Icon/Icon.jsx';
import styles from '../SettingsView.module.css';

/** @param {{ onBack: () => void }} props */
export function AccountInfoView({ onBack }) {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <section className={styles.wrap}>
      <div className={styles.backRow}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <Icon name="ChevronLeft" size={14} />
          <span>Ajustes</span>
        </button>
      </div>
      <header className={styles.header}>
        <h1 className={styles.title}>Cuenta</h1>
      </header>

      <SettingsGroup title="Informacion personal">
        <SettingRow label="Correo electronico" description={user?.email ?? '—'} />
        <SettingRow
          label="ID de usuario"
          description={user?.id ?? '—'}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Seguridad"
        hint="Cambios de contrasena y eliminacion de cuenta proximamente."
      >
        <SettingRow
          label="Cambiar contrasena"
          description="Disponible en una proxima actualizacion."
          control={<LinkButton onClick={() => {}}>Editar</LinkButton>}
        />
      </SettingsGroup>

      <SettingsGroup title="Sesion">
        <button type="button" className={styles.signOut} onClick={signOut}>
          <Icon name="LogOut" size={16} />
          <span>Cerrar sesion</span>
        </button>
      </SettingsGroup>
    </section>
  );
}
