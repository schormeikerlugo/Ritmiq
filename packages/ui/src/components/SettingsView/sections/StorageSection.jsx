/**
 * Seccion de Almacenamiento — solo en desktop por ahora.
 * En PWA el storage se gestiona desde Downloads (storage estimate).
 *
 * @module @ritmiq/ui/components/SettingsView/sections/StorageSection
 */
import { isDesktop } from '../../../lib/api.js';
import { SharedCacheSection } from '../../SettingsDialog/SettingsDialog.jsx';
import { SettingsGroup } from '../SettingsGroup.jsx';
import styles from '../SettingsView.module.css';

export function StorageSection() {
  if (!isDesktop) return null;
  return (
    <SettingsGroup
      title="Almacenamiento"
      hint="Cache compartido entre todos los usuarios pareados con este PC."
    >
      <div className={styles.embed}><SharedCacheSection /></div>
    </SettingsGroup>
  );
}
