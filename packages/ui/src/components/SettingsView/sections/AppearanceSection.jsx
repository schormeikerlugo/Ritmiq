/**
 * Seccion de Apariencia — tema y "Reducir efectos" (lib/perf-mode.js).
 * @module @ritmiq/ui/components/SettingsView/sections/AppearanceSection
 */
import { useState } from 'react';
import { useThemeStore } from '../../../stores/theme.js';
import { getReduceEffectsPref, setReduceEffectsPref, isLowEndDevice } from '../../../lib/perf-mode.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { SegmentedControl } from '../controls/SegmentedControl.jsx';
import { Icon } from '../../Icon/Icon.jsx';

const THEME_OPTS = [
  { id: 'light', label: 'Claro',   icon: <Icon name="Sun" size={14} /> },
  { id: 'dark',  label: 'Oscuro',  icon: <Icon name="Moon" size={14} /> },
  { id: 'auto',  label: 'Sistema', icon: <Icon name="Monitor" size={14} /> },
];

const EFFECTS_OPTS = [
  { id: 'auto', label: 'Auto' },
  { id: 'on',   label: 'Sí' },
  { id: 'off',  label: 'No' },
];

export function AppearanceSection() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [effects, setEffects] = useState(getReduceEffectsPref);
  const onEffects = (v) => { setEffects(v); setReduceEffectsPref(v); };

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
      <SettingRow
        label="Reducir efectos"
        description={`Quita animaciones, desenfoques y sombras para que la app vaya fluida en aparatos modestos. Auto: ${isLowEndDevice() ? 'activado en este aparato' : 'desactivado en este aparato'}. Algunos efectos cambian al reabrir la app.`}
        control={
          <SegmentedControl
            value={effects}
            options={EFFECTS_OPTS}
            onChange={onEffects}
            ariaLabel="Reducir efectos"
          />
        }
      />
    </SettingsGroup>
  );
}
