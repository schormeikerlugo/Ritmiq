import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar.jsx';
import { Library } from './components/Library/Library.jsx';
import { Home } from './components/Home/Home.jsx';
import { Downloads } from './components/Downloads/Downloads.jsx';
import { PlaylistView } from './components/PlaylistView/PlaylistView.jsx';
import { Player } from './components/Player/Player.jsx';
import { TopBar } from './components/TopBar/TopBar.jsx';
import { AuthScreen } from './components/Auth/AuthScreen.jsx';
import { DownloadProgress } from './components/DownloadProgress/DownloadProgress.jsx';
import { QueuePanel } from './components/QueuePanel/QueuePanel.jsx';
import { useAuthStore } from './stores/auth.js';
import { useLibraryStore } from './stores/library.js';
import { usePlaylistsStore } from './stores/playlists.js';
import { useViewStore } from './stores/view.js';
import { usePlayerEngine } from './lib/use-player.js';
import { autoDetectLanFromHost, setLanBaseUrl, getLanBaseUrlSync } from './lib/lan-client.js';
import { api, isDesktop } from './lib/api.js';
import { realtime } from './lib/realtime.js';
import { onConnectionChange } from './lib/connection.js';
import { flushQueue } from './lib/sync-queue.js';
import styles from './App.module.css';

export function App() {
  const { user, loading, init } = useAuthStore();
  const loadLibrary = useLibraryStore((s) => s.load);
  const resetLibrary = useLibraryStore((s) => s.reset);
  const loadPlaylists = usePlaylistsStore((s) => s.load);
  const resetPlaylists = usePlaylistsStore((s) => s.reset);
  const queueOpen = useViewStore((s) => s.queueOpen);
  const sidebarOpen = useViewStore((s) => s.sidebarOpen);
  const closeSidebar = useViewStore((s) => s.closeSidebar);

  // Inicializar sesión Supabase al montar
  useEffect(() => { init(); }, [init]);

  // PWA: auto-detectar LAN server en la IP del host al cargar.
  // Desktop: registrar el LAN URL local (127.0.0.1:<lanPort>) para que las
  // funciones que usan getLanBaseUrlSync (Spotify import, etc.) lo encuentren.
  useEffect(() => {
    if (isDesktop) {
      api.appInfo().then((info) => {
        if (info?.lanPort) setLanBaseUrl(`http://127.0.0.1:${info.lanPort}`);
      }).catch(() => {});
    } else {
      autoDetectLanFromHost().then((url) => {
        if (url) console.info('[lan] auto-conectado:', url);
      });
    }
  }, []);

  // Recargar biblioteca y playlists al cambiar el usuario
  useEffect(() => {
    if (user) {
      loadLibrary();
      loadPlaylists();
    } else {
      resetLibrary();
      resetPlaylists();
    }
  }, [user, loadLibrary, resetLibrary, loadPlaylists, resetPlaylists]);

  // Realtime: suscripción a eventos de Supabase mientras haya sesión.
  useEffect(() => {
    if (!user) return;
    realtime.start(user.id, {
      onTracks: (e) => useLibraryStore.getState().applyRemote(e),
      onPlaylists: (e) => usePlaylistsStore.getState().applyRemotePlaylist(e),
      onPlaylistTracks: (e) => usePlaylistsStore.getState().applyRemotePlaylistTrack(e),
    });
    return () => realtime.stop();
  }, [user]);

  // Drenar la cola pendiente cada vez que recuperamos conexión.
  useEffect(() => {
    return onConnectionChange((online) => {
      if (online) {
        flushQueue().then((n) => {
          if (n > 0) console.info(`[sync-queue] ${n} mutaciones aplicadas tras reconexión`);
        }).catch(() => {});
      }
    });
  }, []);

  // Motor de audio activo siempre que haya sesión
  usePlayerEngine();

  if (loading) {
    return <div className={styles.boot}>Cargando…</div>;
  }
  if (!user) {
    return <AuthScreen />;
  }

  return (
    <div className={styles.shell} data-queue-open={queueOpen}>
      <aside className={styles.sidebar} data-mobile-open={sidebarOpen}>
        <Sidebar />
      </aside>
      <div
        className={styles.scrim}
        data-visible={sidebarOpen}
        onClick={closeSidebar}
        aria-hidden="true"
      />
      <header className={styles.topbar}>
        <TopBar />
      </header>
      <main className={styles.main}>
        <MainView />
      </main>
      <aside className={styles.queue}>
        <QueueOutlet />
      </aside>
      <footer className={styles.player}>
        <Player />
      </footer>
      <DownloadProgress />
    </div>
  );
}

function QueueOutlet() {
  const queueOpen = useViewStore((s) => s.queueOpen);
  const closeQueue = useViewStore((s) => s.closeQueue);
  if (!queueOpen) return null;
  return <QueuePanel onClose={closeQueue} />;
}

function MainView() {
  const view = useViewStore((s) => s.view);
  if (view.kind === 'home') return <Home />;
  if (view.kind === 'library') return <Library />;
  if (view.kind === 'downloads') return <Downloads />;
  if (view.kind === 'playlist') return <PlaylistView playlistId={view.playlistId} />;
  return null;
}
