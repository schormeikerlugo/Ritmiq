/**
 * Subvista de Conexion \u2014 PWA mobile: pareo + LAN + diagnostico.
 * Desktop: dispositivos pareados + motor de descarga.
 *
 * Antes vivian inline en ConnectionSection como bloques apilados con
 * padding inconsistente. Mover a subvista da espacio propio, padding
 * correcto y back navigation \u2014 mismo patron que Cuenta.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/ConnectionInfoView
 */
import { isDesktop } from '../../../lib/api.js';
import {
  PwaPairingSection,
  PwaLanSection,
  PwaDiagnosticsSection,
  DevicesSection,
  YtDlpSection,
} from '../../SettingsDialog/SettingsDialog.jsx';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { Icon } from '../../Icon/Icon.jsx';
import styles from '../SettingsView.module.css';

/** @param {{ onBack: () => void }} props */
export function ConnectionInfoView({ onBack }) {
  return (
    <section className={styles.wrap}>
      <div className={styles.backRow}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <Icon name="ChevronLeft" size={14} />
          <span>Ajustes</span>
        </button>
      </div>
      <header className={styles.header}>
        <h1 className={styles.title}>Conexion</h1>
      </header>

      {isDesktop ? (
        <>
          <SettingsGroup
            title="Dispositivos pareados"
            hint="Aprueba y gestiona los dispositivos que reproducen música desde tu PC o tu servidor 24/7."
          >
            <div className={styles.embed}><DevicesSection /></div>
          </SettingsGroup>
          <SettingsGroup
            title="Motor de descarga"
            hint="yt-dlp es el binario responsable de descargar audio de YouTube."
          >
            <div className={styles.embed}><YtDlpSection /></div>
          </SettingsGroup>
        </>
      ) : (
        <>
          <SettingsGroup
            title="Conexion con tu PC"
            hint="Pareo inicial via QR + IP local."
          >
            <div className={styles.embed}><PwaPairingSection /></div>
          </SettingsGroup>
          <SettingsGroup
            title="Conexion LAN local"
            hint="Si tu PC esta en la misma WiFi, conecta directo via IP local."
          >
            <div className={styles.embed}><PwaLanSection /></div>
          </SettingsGroup>
          <SettingsGroup
            title="Diagnostico de pareo"
            hint="Estado actual de la conexion con tu PC."
          >
            <div className={styles.embed}><PwaDiagnosticsSection /></div>
          </SettingsGroup>
        </>
      )}
    </section>
  );
}
