import { useState } from 'react';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { useViewStore } from '../../stores/view.js';
import { useSocialStore } from '../../stores/social.js';
import { Icon } from '../Icon/Icon.jsx';
import { toast } from '../../stores/toast.js';
import { playPlaylist } from '../../lib/play-helpers.js';
import logotipoUrl from '../../assets/logotipo.png';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const playlists = usePlaylistsStore((s) => s.playlists);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);
  const addTrack = usePlaylistsStore((s) => s.addTrack);
  const { view, goHome, goLibrary, goDownloads, goSettings, goFriends, goPlaylist } = useViewStore();
  const pendingCount = useSocialStore((s) =>
    s.incomingRequests.length + s.inbox.filter((i) => !i.readAt).length
  );
  // Estado del drag-over: id de la playlist sobre la que el cursor esta
  // arrastrando un track. Usado para highlight visual del item.
  const [dragOverId, setDragOverId] = useState(null);

  /**
   * Maneja drop de un track sobre una playlist del sidebar. El track debe
   * venir con MIME type 'application/x-ritmiq-track' (seteado por Library
   * Library.jsx). Otros drops (archivos, URLs externas, etc.) se ignoran.
   */
  const onDropToPlaylist = async (e, playlistId, playlistName) => {
    e.preventDefault();
    setDragOverId(null);
    const trackId = e.dataTransfer.getData('application/x-ritmiq-track');
    if (!trackId) return;
    try {
      await addTrack(playlistId, trackId);
      toast.success(`Anadida a "${playlistName}"`, { icon: 'Check' });
    } catch (err) {
      toast.error(`No se pudo anadir: ${err?.message ?? err}`);
    }
  };

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
        <li>
          <button
            className={styles.link}
            data-active={view.kind === 'friends'}
            onClick={goFriends}
          >
            <span className={styles.icon}><Icon name="Users" size={20} /></span>
            <span>Amigos</span>
            {pendingCount > 0 && (
              <span className={styles.badge}>{pendingCount > 9 ? '9+' : pendingCount}</span>
            )}
          </button>
        </li>
        <li>
          <button
            className={styles.link}
            data-active={view.kind === 'settings'}
            onClick={goSettings}
          >
            <span className={styles.icon}><Icon name="Settings" size={20} /></span>
            <span>Ajustes</span>
          </button>
        </li>
      </ul>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Playlists</div>
        <ul className={styles.list}>
          {sorted.map((pl) => {
            const active = view.kind === 'playlist' && view.playlistId === pl.id;
            const isDragOver = dragOverId === pl.id;
            return (
              <li
                key={pl.id}
                data-drag-over={isDragOver || undefined}
                onDragOver={(e) => {
                  // Solo aceptamos nuestro MIME custom. Si el browser
                  // reporta types vacios (algunos eventos), permitimos
                  // por defecto \u2014 onDrop validara de nuevo.
                  const types = Array.from(e.dataTransfer?.types ?? []);
                  if (types.length === 0 || types.includes('application/x-ritmiq-track')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (dragOverId !== pl.id) setDragOverId(pl.id);
                  }
                }}
                onDragLeave={(e) => {
                  // Solo limpiamos si el cursor salio del <li> realmente,
                  // no si entro a un hijo.
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDragOverId((cur) => (cur === pl.id ? null : cur));
                  }
                }}
                onDrop={(e) => onDropToPlaylist(e, pl.id, pl.name)}
              >
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
                      <img src={pl.coverUrl} alt="" loading="lazy" />
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
