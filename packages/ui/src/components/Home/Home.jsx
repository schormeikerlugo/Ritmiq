import { useAuthStore } from '../../stores/auth.js';
import { useLibraryStore } from '../../stores/library.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { useViewStore } from '../../stores/view.js';
import styles from './Home.module.css';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6)  return 'Buenas noches';
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export function Home() {
  const user = useAuthStore((s) => s.user);
  const tracks = useLibraryStore((s) => s.tracks);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const goLibrary = useViewStore((s) => s.goLibrary);
  const goPlaylist = useViewStore((s) => s.goPlaylist);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);

  const name = user?.email?.split('@')[0] ?? '';

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          {getGreeting()}{name ? `, ${name}` : ''}
        </h1>
        <p className={styles.subtitle}>
          ¿Qué quieres escuchar hoy?
        </p>
      </header>

      <div className={styles.grid}>
        <button className={styles.tile} onClick={goLibrary}>
          <div className={styles.tileIcon} aria-hidden="true">☰</div>
          <div className={styles.tileMeta}>
            <span className={styles.tileTitle}>Tu biblioteca</span>
            <span className={styles.tileSub}>{tracks.length} canciones</span>
          </div>
        </button>

        {playlists.slice(0, 5).map((pl) => (
          <button
            key={pl.id}
            className={styles.tile}
            onClick={() => goPlaylist(pl.id)}
          >
            <div className={styles.tileIcon} aria-hidden="true">
              {pl.id === favoritesId ? '♥' : '♪'}
            </div>
            <div className={styles.tileMeta}>
              <span className={styles.tileTitle}>{pl.name}</span>
              <span className={styles.tileSub}>Playlist</span>
            </div>
          </button>
        ))}
      </div>

      <div className={styles.notice}>
        <span className={styles.noticeBadge}>Próximamente</span>
        <p className={styles.noticeText}>
          Recomendaciones personalizadas según tu historial de reproducción.
        </p>
      </div>
    </section>
  );
}
