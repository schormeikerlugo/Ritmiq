/**
 * Vista "Cuenta" — accesible desde el bottom nav (mobile) o como
 * subseccion completa (desktop). Contiene avatar grande, secciones
 * colapsables con configuracion y ajustes.
 *
 * Stub mínimo. Fase B lo expande con todas las subsecciones extraidas
 * de SettingsDialog.
 *
 * @module @ritmiq/ui/components/AccountView/AccountView
 */
import { useState } from 'react';
import { useAuthStore } from '../../stores/auth.js';
import { isDesktop } from '../../lib/api.js';
import {
  PwaPairingSection,
  PwaDiagnosticsSection,
  PwaRemoteSection,
  SharedCacheSection,
  DevicesSection,
} from '../SettingsDialog/SettingsDialog.jsx';
import { Icon } from '../Icon/Icon.jsx';
import logotipoUrl from '../../assets/logotipo.png';
import styles from './AccountView.module.css';

/** @param {{ title:string, icon?:string, defaultOpen?:boolean, children:React.ReactNode }} props */
export function AccordionSection({ title, icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.section} data-open={open}>
      <button
        type="button"
        className={styles.sectionHead}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {icon && <span className={styles.sectionIcon}><Icon name={icon} size={18} /></span>}
        <span className={styles.sectionTitle}>{title}</span>
        <span className={styles.sectionChevron} aria-hidden="true">
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} />
        </span>
      </button>
      <div className={styles.sectionBody} aria-hidden={!open}>
        <div className={styles.sectionInner}>{children}</div>
      </div>
    </section>
  );
}

export function AccountView() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const initial = (user?.email ?? 'U').slice(0, 1).toUpperCase();

  return (
    <section className={styles.wrap}>
      <div className={styles.brandTop}>
        <img src={logotipoUrl} alt="Ritmiq" className={styles.brandLogo} />
      </div>
      <header className={styles.header}>
        <div className={styles.avatarBig}>{initial}</div>
        <div className={styles.identity}>
          <h1 className={styles.name}>{user?.email?.split('@')[0] ?? 'Cuenta'}</h1>
          <p className={styles.muted}>{user?.email ?? ''}</p>
        </div>
      </header>

      {/* PWA: pareo + diagnostico + URL fallback */}
      {!isDesktop && (
        <>
          <AccordionSection title="Parear con tu PC" icon="Wifi" defaultOpen>
            <div className={styles.embed}><PwaPairingSection /></div>
          </AccordionSection>
          <AccordionSection title="Diagnóstico de conexión" icon="AlertCircle">
            <div className={styles.embed}><PwaDiagnosticsSection /></div>
          </AccordionSection>
          <AccordionSection title="Acceso remoto (compat)" icon="Cloud">
            <div className={styles.embed}><PwaRemoteSection /></div>
          </AccordionSection>
        </>
      )}

      {/* Desktop: dispositivos pareados + cache + tunnel */}
      {isDesktop && (
        <>
          <AccordionSection title="Dispositivos conectados" icon="Cast" defaultOpen>
            <div className={styles.embed}><DevicesSection /></div>
          </AccordionSection>
          <AccordionSection title="Cache compartido" icon="ArrowDownToLine">
            <div className={styles.embed}><SharedCacheSection /></div>
          </AccordionSection>
        </>
      )}

      <AccordionSection title="Apariencia" icon="Settings">
        <p className={styles.muted}>Tema e idioma. (Próximamente.)</p>
      </AccordionSection>

      <AccordionSection title="Acerca de" icon="Info">
        <div className={styles.aboutGrid}>
          <div><strong>Ritmiq</strong></div>
          <div className={styles.muted}>Versión 0.1.0</div>
          <div className={styles.muted}>
            {isDesktop ? 'Modo: Desktop (Electron)' : 'Modo: PWA'}
          </div>
        </div>
      </AccordionSection>

      <div className={styles.dangerZone}>
        <button className={styles.signOut} onClick={signOut}>
          <Icon name="LogOut" size={16} />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </section>
  );
}
