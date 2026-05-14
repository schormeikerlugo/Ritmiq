import { useState } from 'react';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { useViewStore } from '../../stores/view.js';
import { SpotifyImportDialog } from '../SpotifyImportDialog/SpotifyImportDialog.jsx';
import { Icon } from '../Icon/Icon.jsx';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const playlists = usePlaylistsStore((s) => s.playlists);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);
  const { view, goHome, goLibrary, goDownloads, goPlaylist } = useViewStore();
  const [importOpen, setImportOpen] = useState(false);

  // Ordenar: Favoritas primero, luego por created_at.
  const sorted = playlists.slice().sort((a, b) => {
    if (a.id === favoritesId) return -1;
    if (b.id === favoritesId) return 1;
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  });

  return (
    <nav className={styles.nav}>
      <div className={styles.brand}>
        <img src="/logotipo.png" alt="Ritmiq" className={styles.brandLogo} />
      </div>
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
        <button
          className={styles.importBtn}
          onClick={() => setImportOpen(true)}
        >
          <span className={styles.importIcon} aria-hidden="true"><Icon name="Music2" size={18} /></span>
          <div className={styles.importMeta}>
            <span className={styles.importTitle}>Importar de Spotify</span>
            <span className={styles.importSub}>Pega un link público</span>
          </div>
        </button>
      </div>

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
                </button>
              </li>
            );
          })}
          {sorted.length === 0 && (
            <li className={styles.muted}>Sin playlists</li>
          )}
        </ul>
      </div>

      {importOpen && (
        <SpotifyImportDialog onClose={() => setImportOpen(false)} />
      )}
    </nav>
  );
}
