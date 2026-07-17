/**
 * Seccion de Conexion en el listado principal de Ajustes \u2014 ahora
 * solo muestra dos rows clickeables que navegan a subvistas con
 * padding y back navigation propios. Antes apilaba los formularios
 * inline lo cual producia padding inconsistente y vista demasiado
 * larga.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/ConnectionSection
 */
import { useEffect, useState } from 'react';
import { useViewStore } from '../../../stores/view.js';
import { useSettingsStore } from '../../../stores/settings.js';
import { isDesktop } from '../../../lib/api.js';
import { lastActiveEndpoint } from '../../../lib/use-player.js';
import {
  getLanBaseUrlSync, getTunnelUrlSync, getServerUrlSync, pingLan,
} from '../../../lib/lan-client.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';
import { SegmentedControl } from '../controls/SegmentedControl.jsx';

const MODE_OPTIONS = [
  { id: 'auto', label: 'Servidor 24/7' },
  { id: 'prefer-desktop', label: 'Mi PC' },
  { id: 'fastest', label: 'Mas rapido' },
];

const KIND_LABEL = {
  lan: 'PC local (LAN)',
  desktop: 'PC (tunel)',
  server: 'Servidor 24/7',
};

export function ConnectionSection() {
  const setSubview = useViewStore((s) => s.setSettingsSubview);
  const serverMode = useSettingsStore((s) => s.serverMode);
  const setServerMode = useSettingsStore((s) => s.setServerMode);

  // Indicador del endpoint activo: qué candidatos hay y a cuál se resolvió.
  const [status, setStatus] = useState({ active: lastActiveEndpoint.kind, checking: false });

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const candidates = {
        lan: getLanBaseUrlSync(),
        desktop: getTunnelUrlSync(),
        server: getServerUrlSync(),
      };
      const anyCandidate = Object.values(candidates).some(Boolean);
      if (!anyCandidate) {
        if (!cancelled) setStatus({ active: null, checking: false, candidates });
        return;
      }
      if (!cancelled) setStatus((s) => ({ ...s, checking: true, candidates }));
      // Ping ligero al endpoint que el player marcó como activo (o el server).
      const target = candidates[lastActiveEndpoint.kind] || candidates.server || candidates.lan || candidates.desktop;
      const ok = target ? await pingLan(target, 2000) : false;
      if (!cancelled) {
        setStatus({
          active: ok ? (lastActiveEndpoint.kind ?? null) : null,
          checking: false,
          candidates,
        });
      }
    };
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [serverMode]);

  const activeLabel = status.active
    ? KIND_LABEL[status.active] ?? status.active
    : (status.checking ? 'Comprobando…' : 'Sin conexion directa (usa nube)');

  return (
    <>
      <SettingsGroup title="Servidor de reproduccion">
        <SettingRow
          label="Modo de conexion"
          description="Elige que host resuelve y transmite el audio. Por defecto usa el 'Servidor 24/7' (mas rapido y siempre disponible); 'Mi PC' prioriza tu desktop en la misma red; 'Mas rapido' compite ambos."
          control={
            <SegmentedControl
              value={serverMode}
              options={MODE_OPTIONS}
              onChange={setServerMode}
              ariaLabel="Modo de servidor"
            />
          }
        />
        <SettingRow
          label="Conectado a"
          description="Endpoint activo ahora mismo para buscar/reproducir."
          control={<span data-endpoint-status>{activeLabel}</span>}
        />
      </SettingsGroup>

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
    </>
  );
}
