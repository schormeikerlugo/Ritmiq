/**
 * Vista de Ajustes — estilo Spotify Configuracion.
 *
 * Layout plano (sin acordeon, sin modal). Cada grupo lleva titulo H2 y
 * lista de SettingRow. Header sticky con H1 "Ajustes" arriba del scroll.
 *
 * Esta vista reemplaza el antiguo AccountView + SettingsDialog modal.
 * Una sola superficie para todos los settings de la app.
 *
 * @module @ritmiq/ui/components/SettingsView
 */
import { useViewStore } from '../../stores/view.js';
import { AccountSection } from './sections/AccountSection.jsx';
import { AppearanceSection } from './sections/AppearanceSection.jsx';
import { PlaybackSection } from './sections/PlaybackSection.jsx';
import { ConnectionSection } from './sections/ConnectionSection.jsx';
import { StorageSection } from './sections/StorageSection.jsx';
import { AboutSection } from './sections/AboutSection.jsx';
import { DiagnosticsSection } from './sections/DiagnosticsSection.jsx';
import { AccountInfoView } from './sections/AccountInfoView.jsx';
import styles from './SettingsView.module.css';

export function SettingsView() {
  const subview = useViewStore((s) => s.settingsSubview);
  const setSubview = useViewStore((s) => s.setSettingsSubview);

  // Subvistas: cuando el usuario navega a una pantalla "hija" (ej. detalle
  // de Cuenta) la vista renderiza ese componente en su lugar. Eso evita
  // tener que crear un view.kind nuevo para cada subseccion futura.
  if (subview === 'account') {
    return <AccountInfoView onBack={() => setSubview(null)} />;
  }

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Ajustes</h1>
      </header>

      <AccountSection />
      <AppearanceSection />
      <PlaybackSection />
      <ConnectionSection />
      <StorageSection />
      <AboutSection />
      <DiagnosticsSection />
    </section>
  );
}
