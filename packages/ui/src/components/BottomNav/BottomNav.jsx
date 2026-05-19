/**
 * Navegacion inferior estilo Spotify para mobile.
 *
 * 4 tabs: Inicio · Buscar · Biblioteca · Cuenta.
 *
 * - Visible solo en mobile (<=768px).
 * - Indicador animado del tab activo.
 * - Respeta safe-area-inset-bottom (iPhone home indicator).
 * - Tap → cambia view via useViewStore.
 *
 * @module @ritmiq/ui/components/BottomNav/BottomNav
 */
import { useAuthStore } from '../../stores/auth.js';
import { useViewStore } from '../../stores/view.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './BottomNav.module.css';

export function BottomNav() {
  const view = useViewStore((s) => s.view);
  const goHome = useViewStore((s) => s.goHome);
  const goSearchView = useViewStore((s) => s.goSearchView);
  const goLibrary = useViewStore((s) => s.goLibrary);
  const goAccount = useViewStore((s) => s.goAccount);
  const user = useAuthStore((s) => s.user);

  const tabs = [
    { id: 'home',    label: 'Inicio',     icon: 'Home',    isActive: view.kind === 'home', onClick: goHome },
    { id: 'search',  label: 'Buscar',     icon: 'Search',  isActive: view.kind === 'search', onClick: goSearchView },
    { id: 'library', label: 'Biblioteca', icon: 'Library', isActive: view.kind === 'library', onClick: goLibrary },
    { id: 'account', label: 'Cuenta',     icon: 'User',    isActive: view.kind === 'account', onClick: goAccount, avatar: true },
  ];

  return (
    <nav className={styles.nav} aria-label="Navegacion principal">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={styles.tab}
          data-active={t.isActive}
          onClick={t.onClick}
          aria-label={t.label}
          aria-current={t.isActive ? 'page' : undefined}
        >
          {t.avatar && user ? (
            <span className={styles.avatar} aria-hidden="true">
              {(user.email ?? 'U').slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <Icon name={t.icon} size={22} filled={t.isActive} />
          )}
          <span className={styles.label}>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
