/**
 * Seccion de Cuenta — fila clickable que abre la subvista con info
 * detallada del usuario.
 *
 * Patron estilo Spotify: la seccion principal solo muestra el email
 * + chevron. Al hacer click se navega a una "subvista" donde van los
 * controles avanzados (cambiar email, password, eliminar cuenta).
 *
 * @module @ritmiq/ui/components/SettingsView/sections/AccountSection
 */
import { useAuthStore } from '../../../stores/auth.js';
import { useViewStore } from '../../../stores/view.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';

export function AccountSection() {
  const user = useAuthStore((s) => s.user);
  const setSubview = useViewStore((s) => s.setSettingsSubview);

  return (
    <SettingsGroup title="Cuenta">
      <SettingRow
        label="Iniciar sesion"
        description={user?.email ?? 'Sin sesion'}
        control={<LinkButton onClick={() => setSubview('account')}>Editar</LinkButton>}
      />
    </SettingsGroup>
  );
}
