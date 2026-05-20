/**
 * Seccion de Apariencia — solo tema por ahora. Futuro: idioma, densidad.
 * @module @ritmiq/ui/components/SettingsView/sections/AppearanceSection
 */
import { useThemeStore } from '../../../stores/theme.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { SegmentedControl } from '../controls/SegmentedControl.jsx';
import { Icon } from '../../Icon/Icon.jsx';

const THEME_OPTS = [
  { id: 'light', label: 'Claro',   icon: <Icon name="Sun" size={14} /> },
  { id: 'dark',  label: 'Oscuro',  icon: <Icon name="Moon" size={14} /> },
  { id: 'auto',  label: 'Sistema', icon: <Icon name="Monitor" size={14} /> },
];

export function AppearanceSection() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <SettingsGroup title="Apariencia">
      <SettingRow
        label="Tema"
        description="Claro, oscuro, o seguir el sistema."
        control={
          <SegmentedControl
            value={theme}
            options={THEME_OPTS}
            onChange={setTheme}
            ariaLabel="Tema"
          />
        }
      />
    </SettingsGroup>
  );
}
