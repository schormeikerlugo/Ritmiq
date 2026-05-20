/**
 * Grupo de configuracion — titulo H2 + lista de SettingRow.
 * Estilo Spotify: plano, sin bordes ni acordeon, separado solo por
 * espaciado vertical.
 *
 * @module @ritmiq/ui/components/SettingsView/SettingsGroup
 */
import styles from './SettingsView.module.css';

/** @param {{ title: string, children: React.ReactNode, hint?: string }} props */
export function SettingsGroup({ title, hint, children }) {
  return (
    <section className={styles.group} aria-labelledby={`grp-${title}`}>
      <h2 id={`grp-${title}`} className={styles.groupTitle}>{title}</h2>
      {hint && <p className={styles.groupHint}>{hint}</p>}
      <div className={styles.groupBody}>{children}</div>
    </section>
  );
}
