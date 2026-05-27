/**
 * Subvista Acerca de — descripcion completa de Ritmiq + link al sitio
 * del desarrollador + version + modo de ejecucion.
 *
 * @module @ritmiq/ui/components/SettingsView/sections/AboutInfoView
 */
import { isDesktop } from '../../../lib/api.js';
import { useViewStore } from '../../../stores/view.js';
import { SettingsGroup } from '../SettingsGroup.jsx';
import { SettingRow } from '../SettingRow.jsx';
import { LinkButton } from '../controls/LinkButton.jsx';
import { Icon } from '../../Icon/Icon.jsx';
import logotipoUrl from '../../../assets/logotipo.png';
import styles from '../SettingsView.module.css';
import aboutStyles from './AboutInfoView.module.css';

const DEV_SITE = 'https://schormeiker.com';

/** @param {{ onBack: () => void }} props */
export function AboutInfoView({ onBack }) {
  const goStats = useViewStore((s) => s.goStats);

  return (
    <section className={styles.wrap}>
      <div className={styles.backRow}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <Icon name="ChevronLeft" size={14} />
          <span>Ajustes</span>
        </button>
      </div>
      <header className={styles.header}>
        <h1 className={styles.title}>Acerca de</h1>
      </header>

      {/* Bloque hero: que es Ritmiq */}
      <div className={aboutStyles.hero}>
        <div className={aboutStyles.brandRow}>
          <img
            src={logotipoUrl}
            alt="Ritmiq"
            className={aboutStyles.brandIcon}
            width={56}
            height={56}
          />
          <div className={aboutStyles.brandText}>
            <h2 className={aboutStyles.brandName}>Ritmiq</h2>
            <p className={aboutStyles.tagline}>Tu música, tu ritmo, sin anuncios.</p>
          </div>
        </div>
        <p className={aboutStyles.description}>
          Ritmiq es un reproductor de música personal diseñado para que
          escuches lo que quieras sin interrupciones, sin algoritmos
          opacos y sin pagar suscripciones mensuales. Encuentra cualquier
          canción en YouTube, organiza tu biblioteca, comparte música
          con amigos y lleva tu colección a cualquier dispositivo — PC,
          teléfono o tablet.
        </p>
        <ul className={aboutStyles.featureList}>
          <li>
            <Icon name="Headphones" size={14} />
            <span>Streaming + descarga offline desde YouTube</span>
          </li>
          <li>
            <Icon name="Users" size={14} />
            <span>Comparte canciones y playlists con tus amigos</span>
          </li>
          <li>
            <Icon name="Music" size={14} />
            <span>Ecualizador de 6 bandas con presets</span>
          </li>
          <li>
            <Icon name="Sparkles" size={14} />
            <span>Sincroniza tu PC y tu teléfono en LAN o por internet</span>
          </li>
        </ul>
      </div>

      <SettingsGroup
        title="Actividad"
        hint="Tu historial agregado: top tracks, artistas, minutos escuchados, racha de días."
      >
        <SettingRow
          label="Tu mes en Ritmiq"
          description="Top tracks, artistas, minutos escuchados y más."
          control={<LinkButton onClick={goStats}>Ver</LinkButton>}
        />
      </SettingsGroup>

      <SettingsGroup title="Desarrollador">
        <SettingRow
          label="schormeiker.com"
          description="Sitio personal del desarrollador. Otros proyectos, contacto y blog."
          control={
            <a
              href={DEV_SITE}
              target="_blank"
              rel="noopener noreferrer"
              className={aboutStyles.linkBtn}
            >
              <span>Visitar</span>
              <Icon name="ExternalLink" size={12} />
            </a>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Detalles técnicos">
        <SettingRow label="Versión" description="0.1.0" />
        <SettingRow
          label="Modo"
          description={isDesktop ? 'Desktop (Electron)' : 'PWA (Web)'}
        />
      </SettingsGroup>
    </section>
  );
}
