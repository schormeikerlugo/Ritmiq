/**
 * Seccion de Conexion en el listado principal de Ajustes \u2014 ahora
 * solo muestra dos rows clickeables que navegan a subvistas con
 * padding y back navigation propios. Antes apilaba los formularios
 * inline lo cual producia padding inconsistente y vista demasiado
 * larga.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/ConnectionSection
 */
import { useViewStore } from '../../../stores/view.js';
import { isDesktop } from '../../../lib/api.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';

export function ConnectionSection() {
  const setSubview = useViewStore((s) => s.setSettingsSubview);

  return (
    <SettingsGroup title="Conexion">
      <SettingRow
        label={isDesktop ? 'Dispositivos pareados' : 'Conexion con tu PC'}
        description={
          isDesktop
            ? 'Telefonos pareados con este PC + motor de descarga yt-dlp.'
            : 'Pareo via QR, LAN local y diagnostico de la conexion.'
        }
        control={
          <LinkButton onClick={() => setSubview('connection')}>
            Configurar
          </LinkButton>
        }
      />
      <SettingRow
        label="Acceso remoto"
        description={
          isDesktop
            ? 'Tunel Cloudflare + token de acceso para uso fuera de casa.'
            : 'Tunel publico para reproducir desde fuera de tu WiFi.'
        }
        control={
          <LinkButton onClick={() => setSubview('remote')}>
            Configurar
          </LinkButton>
        }
      />
    </SettingsGroup>
  );
}
