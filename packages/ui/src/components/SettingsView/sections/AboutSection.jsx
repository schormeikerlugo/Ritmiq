/**
 * Seccion Acerca de en el listado principal de Ajustes \u2014 row
 * clickeable que navega a la subvista AboutInfoView (con descripcion
 * de Ritmiq, link al desarrollador y detalles tecnicos).
 *
 * Tambien expone la entrada a Diagnostico aqui porque es contenido
 * de meta-informacion sobre la app, mismo tipo que Acerca de.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/AboutSection
 */
import { useViewStore } from '../../../stores/view.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';

export function AboutSection() {
  const setSubview = useViewStore((s) => s.setSettingsSubview);

  return (
    <SettingsGroup title="Acerca de">
      <SettingRow
        label="Que es Ritmiq"
        description="Descripcion, version, desarrollador y enlace al sitio."
        control={
          <LinkButton onClick={() => setSubview('about')}>
            Ver
          </LinkButton>
        }
      />
      <SettingRow
        label="Diagnostico"
        description="Estado de las APIs de la PWA (push, badge, sesion, modo de display)."
        control={
          <LinkButton onClick={() => setSubview('diagnostics')}>
            Ver
          </LinkButton>
        }
      />
    </SettingsGroup>
  );
}
