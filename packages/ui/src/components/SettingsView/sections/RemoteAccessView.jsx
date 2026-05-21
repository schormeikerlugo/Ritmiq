/**
 * Subvista de Acceso remoto \u2014 tunel Cloudflare para usar Ritmiq fuera
 * de casa (cuando el telefono no esta en la misma WiFi del PC).
 *
 * En PWA mobile: configurar URL del tunel + token de acceso.
 * En desktop: configurar el tunel local + generar token de acceso.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/RemoteAccessView
 */
import { isDesktop } from '../../../lib/api.js';
import {
  PwaRemoteSection,
  DesktopTunnelSection,
  DesktopAccessTokenSection,
} from '../../SettingsDialog/SettingsDialog.jsx';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { Icon } from '../../Icon/Icon.jsx';
import styles from '../SettingsView.module.css';

/** @param {{ onBack: () => void }} props */
export function RemoteAccessView({ onBack }) {
  return (
    <section className={styles.wrap}>
      <div className={styles.backRow}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <Icon name="ChevronLeft" size={14} />
          <span>Ajustes</span>
        </button>
      </div>
      <header className={styles.header}>
        <h1 className={styles.title}>Acceso remoto</h1>
      </header>

      {isDesktop ? (
        <>
          <SettingsGroup
            title="Tunel Cloudflare"
            hint="URL publica para que tu telefono se conecte fuera de casa."
          >
            <div className={styles.embed}><DesktopTunnelSection /></div>
          </SettingsGroup>
          <SettingsGroup
            title="Token de acceso"
            hint="Comparte este token con tu telefono para autenticar las requests."
          >
            <div className={styles.embed}><DesktopAccessTokenSection /></div>
          </SettingsGroup>
        </>
      ) : (
        <SettingsGroup
          title="Tunel para reproducir desde fuera"
          hint="Si tu PC tiene un Cloudflare Tunnel configurado, pega aqui la URL publica."
        >
          <div className={styles.embed}><PwaRemoteSection /></div>
        </SettingsGroup>
      )}
    </section>
  );
}
