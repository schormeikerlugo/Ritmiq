/**
 * Subvista de Diagnostico \u2014 wrapper que envuelve DiagnosticsSection con
 * header + back button. Mantiene la seccion inline para reusabilidad
 * (puede embeberse en cualquier sitio futuro), solo cambia el chrome.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/DiagnosticsInfoView
 */
import { DiagnosticsSection } from './DiagnosticsSection.jsx';
import { Icon } from '../../Icon/Icon.jsx';
import styles from '../SettingsView.module.css';

/** @param {{ onBack: () => void }} props */
export function DiagnosticsInfoView({ onBack }) {
  return (
    <section className={styles.wrap}>
      <div className={styles.backRow}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <Icon name="ChevronLeft" size={14} />
          <span>Ajustes</span>
        </button>
      </div>
      <header className={styles.header}>
        <h1 className={styles.title}>Diagnostico</h1>
        <p className={styles.subtitle}>
          Estado de las APIs criticas de la PWA. Util para verificar
          push, badge, sesion y detectar problemas de configuracion.
        </p>
      </header>

      <DiagnosticsSection />
    </section>
  );
}
