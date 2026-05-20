import { usePlaylistsStore } from '../../stores/playlists.js';
import { useViewStore } from '../../stores/view.js';
import { Icon } from '../Icon/Icon.jsx';
import { playPlaylist } from '../../lib/play-helpers.js';
import logotipoUrl from '../../assets/logotipo.png';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const playlists = usePlaylistsStore((s) => s.playlists);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);
  const { view, goHome, goLibrary, goDownloads, goPlaylist } = useViewStore();

  // Ordenar: Favoritas primero, luego por created_at.
  const sorted = playlists.slice().sort((a, b) => {
    if (a.id === favoritesId) return -1;
    if (b.id === favoritesId) return 1;
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  });

  return (
    <nav className={styles.nav}>
      {/* Logotipo Ritmiq — click va a Home, mismo patron que un logo de
          app en barra lateral. Solo visible en sidebar desktop (en mobile
          la sidebar esta oculta). */}
      <button
        type="button"
        className={styles.brand}
        onClick={goHome}
        aria-label="Ritmiq — Inicio"
      >
        <img src={logotipoUrl} alt="Ritmiq" className={styles.brandLogo} />
      </button>

      <ul className={styles.list}>
        <li>
          <button
            className={styles.link}
            data-active={view.kind === 'home'}
            onClick={goHome}
          >
            <span className={styles.icon}><Icon name="Home" size={20} /></span>
            <span>Inicio</span>
          </button>
        </li>
        <li>
          <button
            className={styles.link}
            data-active={view.kind === 'library'}
            onClick={goLibrary}
          >
            <span className={styles.icon}><Icon name="Library" size={20} /></span>
            <span>Biblioteca</span>
          </button>
        </li>
        <li>
          <button
            className={styles.link}
            data-active={view.kind === 'downloads'}
            onClick={goDownloads}
          >
            <span className={styles.icon}><Icon name="ArrowDownToLine" size={20} /></span>
            <span>Descargas</span>
          </button>
        </li>
      </ul>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Playlists</div>
        <ul className={styles.list}>
          {sorted.map((pl) => {
            const active = view.kind === 'playlist' && view.playlistId === pl.id;
            return (
              <li key={pl.id}>
                <button
                  className={styles.link}
                  data-active={active}
                  onClick={() => goPlaylist(pl.id)}
                >
                  <span
                    className={styles.thumb}
                    data-favs={pl.id === favoritesId}
                    data-has-image={!!pl.coverUrl}
                  >
                    {pl.coverUrl ? (
                      <img src={pl.coverUrl} alt="" />
                    ) : (
                      <Icon name={pl.id === favoritesId ? 'Heart' : 'Music'} size={16} filled={pl.id === favoritesId} />
                    )}
                  </span>
                  <span className={styles.linkText}>{pl.name}</span>
                  {/* Quick-play en hover sobre la fila — al ser items
                      compactos lo posicionamos al final, no sobre el
                      thumb (28px es muy pequeño para overlay). */}
                  <span
                    className={styles.quickPlay}
                    role="button"
                    tabIndex={-1}
                    aria-label={`Reproducir ${pl.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      playPlaylist(pl.id);
                    }}
                  >
                    <Icon name="Play" size={12} filled />
                  </span>
                </button>
              </li>
            );
          })}
          {sorted.length === 0 && (
            <li className={styles.muted}>Sin playlists</li>
          )}
        </ul>
      </div>

    </nav>
  );
}
