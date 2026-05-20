/**
 * Seccion de Conexion — pareo + LAN + tunel + diagnostico.
 *
 * Reusa las subsecciones complejas que ya existen en SettingsDialog.jsx
 * (exportadas alli como funciones independientes). Estas subsecciones
 * son complejas (formularios, escaneo, QR) y mantenerlas en su archivo
 * original evita riesgo de regresion. En el futuro se migraran a este
 * directorio.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/ConnectionSection
 */
import { isDesktop } from '../../../lib/api.js';
import {
  PwaPairingSection,
  PwaLanSection,
  PwaRemoteSection,
  PwaDiagnosticsSection,
  DevicesSection,
  DesktopTunnelSection,
  DesktopAccessTokenSection,
  YtDlpSection,
} from '../../SettingsDialog/SettingsDialog.jsx';
import { SettingsGroup } from '../SettingsGroup.jsx';
import styles from '../SettingsView.module.css';

export function ConnectionSection() {
  if (isDesktop) {
    return (
      <>
        <SettingsGroup
          title="Dispositivos"
          hint="Telefonos pareados que pueden reproducir musica desde este PC."
        >
          <div className={styles.embed}><DevicesSection /></div>
        </SettingsGroup>
        <SettingsGroup
          title="Acceso remoto"
          hint="Tunel Cloudflare para que tu telefono se conecte fuera de casa."
        >
          <div className={styles.embed}><DesktopTunnelSection /></div>
          <div className={styles.embed}><DesktopAccessTokenSection /></div>
        </SettingsGroup>
        <SettingsGroup
          title="Motor de descarga"
          hint="yt-dlp es el binario responsable de descargar audio de YouTube."
        >
          <div className={styles.embed}><YtDlpSection /></div>
        </SettingsGroup>
      </>
    );
  }

  return (
    <>
      <SettingsGroup
        title="Conexion con tu PC"
        hint="Conecta este movil con la app de escritorio en tu PC para reproducir tu biblioteca."
      >
        <div className={styles.embed}><PwaPairingSection /></div>
        <div className={styles.embed}><PwaLanSection /></div>
        <div className={styles.embed}><PwaDiagnosticsSection /></div>
      </SettingsGroup>
      <SettingsGroup
        title="Acceso remoto"
        hint="Tunel para reproducir desde fuera de tu casa."
      >
        <div className={styles.embed}><PwaRemoteSection /></div>
      </SettingsGroup>
    </>
  );
}
