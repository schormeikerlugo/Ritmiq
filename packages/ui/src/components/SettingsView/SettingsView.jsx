/**
 * Vista de Ajustes \u2014 estilo Spotify Configuracion.
 *
 * Layout plano (sin acordeon, sin modal). Cada grupo lleva titulo H2 y
 * lista de SettingRow. Header sticky con H1 "Ajustes" arriba del scroll.
 *
 * Cuando settingsSubview esta seteado, renderizamos la subvista
 * correspondiente en lugar del listado plano. Patron drill-down igual
 * al de iOS Ajustes: cada item complejo abre su propia pantalla con
 * header + back button.
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
import { AccountInfoView } from './sections/AccountInfoView.jsx';
import { ConnectionInfoView } from './sections/ConnectionInfoView.jsx';
import { RemoteAccessView } from './sections/RemoteAccessView.jsx';
import { DiagnosticsInfoView } from './sections/DiagnosticsInfoView.jsx';
import { AboutInfoView } from './sections/AboutInfoView.jsx';
import styles from './SettingsView.module.css';

export function SettingsView() {
  const subview = useViewStore((s) => s.settingsSubview);
  const setSubview = useViewStore((s) => s.setSettingsSubview);

  // Drill-down: cada subview tiene su propio header + back button.
  // Centralizamos el dispatch aqui para no replicar la logica de
  // navegacion en cada seccion del listado principal.
  const back = () => setSubview(null);
  if (subview === 'account')     return <AccountInfoView     onBack={back} />;
  if (subview === 'connection')  return <ConnectionInfoView  onBack={back} />;
  if (subview === 'remote')      return <RemoteAccessView    onBack={back} />;
  if (subview === 'diagnostics') return <DiagnosticsInfoView onBack={back} />;
  if (subview === 'about')       return <AboutInfoView       onBack={back} />;

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
    </section>
  );
}
