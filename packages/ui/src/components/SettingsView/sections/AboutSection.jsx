/**
 * Seccion Acerca de — version, modo, link a Stats.
 * @module @ritmiq/ui/components/SettingsView/sections/AboutSection
 */
import { useViewStore } from '../../../stores/view.js';
import { isDesktop } from '../../../lib/api.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';

export function AboutSection() {
  const goStats = useViewStore((s) => s.goStats);

  return (
    <>
      <SettingsGroup title="Actividad">
        <SettingRow
          label="Tu mes en Ritmiq"
          description="Top tracks, artistas, minutos escuchados y mas."
          control={<LinkButton onClick={goStats}>Ver</LinkButton>}
        />
      </SettingsGroup>

      <SettingsGroup title="Acerca de">
        <SettingRow label="Version" description="0.1.0" />
        <SettingRow
          label="Modo"
          description={isDesktop ? 'Desktop (Electron)' : 'PWA (Web)'}
        />
      </SettingsGroup>
    </>
  );
}
