import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar.jsx';
import { Library } from './components/Library/Library.jsx';
import { Home } from './components/Home/Home.jsx';
import { Downloads } from './components/Downloads/Downloads.jsx';
import { PlaylistView } from './components/PlaylistView/PlaylistView.jsx';
import { SearchView } from './components/SearchView/SearchView.jsx';
import { ArtistView } from './components/ArtistView/ArtistView.jsx';
import { AlbumView } from './components/AlbumView/AlbumView.jsx';
import { Player } from './components/Player/Player.jsx';
import { TopBar } from './components/TopBar/TopBar.jsx';
import { BottomNav } from './components/BottomNav/BottomNav.jsx';
import { AccountView } from './components/AccountView/AccountView.jsx';
import { AuthScreen } from './components/Auth/AuthScreen.jsx';
import { DownloadProgress } from './components/DownloadProgress/DownloadProgress.jsx';
import { QueuePanel } from './components/QueuePanel/QueuePanel.jsx';
import { NowPlaying } from './components/NowPlaying/NowPlaying.jsx';
import { BottomSheetHost } from './components/BottomSheet/BottomSheetHost.jsx';
import logotipoUrl from './assets/logotipo.png';
import { useAuthStore } from './stores/auth.js';
import { useLibraryStore } from './stores/library.js';
import { usePlaylistsStore } from './stores/playlists.js';
import { useHistoryStore } from './stores/history.js';
import { useRecommendationsStore } from './stores/recommendations.js';
import { useArtistStore } from './stores/artist.js';
import { useSearchStore } from './stores/search.js';
import { useViewStore } from './stores/view.js';
import { usePlayerEngine } from './lib/use-player.js';
import { useGlobalShortcuts } from './lib/use-shortcuts.js';
import { initTheme } from './stores/theme.js';

// Aplica el tema guardado en localStorage al <html> ANTES del primer render.
// Idempotente — si ya estaba aplicado por otro modulo, no hace nada nuevo.
initTheme();
import {
  autoDetectLanFromHost, setLanBaseUrl, getLanBaseUrlSync, setAccessToken,
  startTunnelKeepalive,
} from './lib/lan-client.js';
import { api, isDesktop } from './lib/api.js';
import { realtime } from './lib/realtime.js';
import { onConnectivityChange, forceRecheck } from './lib/connectivity.js';
import { flushQueue } from './lib/sync-queue.js';
import { subscribeTunnelUrl, publishTunnelUrl, clearTunnelUrl } from './lib/tunnel-registry.js';
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
  const nowPlayingOpen = useViewStore((s) => s.nowPlayingOpen);

  // Inicializar sesión Supabase al montar
  useEffect(() => { init(); }, [init]);

  // PWA: auto-detectar LAN server en la IP del host al cargar.
  // Desktop: registrar el LAN URL local (127.0.0.1:<lanPort>) para que las
  // funciones que usan getLanBaseUrlSync (Spotify import, etc.) lo encuentren.
  useEffect(() => {
    if (isDesktop) {
      api.appInfo().then((info) => {
        if (info?.lanPort) setLanBaseUrl(`http://127.0.0.1:${info.lanPort}`);
        // El renderer desktop también necesita el access token para
        // autenticarse contra su propio LAN server.
        if (info?.accessToken) setAccessToken(info.accessToken);
      }).catch(() => {});
    } else {
      autoDetectLanFromHost().then((url) => {
        if (url) console.info('[lan] auto-conectado:', url);
      });
    }
  }, []);

  // PWA: mantener vivo el Cloudflare Tunnel para que el primer request no
  // pague cold start (~1-3s extra de TTFB cuando cloudflared estuvo idle).
  // Desktop no lo necesita (todo localhost).
  useEffect(() => {
    if (isDesktop) return;
    return startTunnelKeepalive();
  }, []);

  // Recargar biblioteca y playlists al cambiar el usuario
  useEffect(() => {
    if (user) {
      loadLibrary();
      loadPlaylists();
      useHistoryStore.getState().load();
    } else {
      resetLibrary();
      resetPlaylists();
      useHistoryStore.getState().reset();
      useRecommendationsStore.getState().reset();
      useArtistStore.getState().reset();
      useSearchStore.getState().reset();
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

  // Detector unificado de conectividad: dispara reconciliación al
  // recuperar internet, y refresca la fuente cuando vuelve LAN/tunnel.
  useEffect(() => {
    if (!user) return;
    let prev = { internet: false, lan: false, tunnel: false };
    return onConnectivityChange((s) => {
      const recoveredInternet = !prev.internet && s.internet;
      const recoveredDesktop = (!prev.lan && s.lan) || (!prev.tunnel && s.tunnel);
      prev = s;

      if (recoveredInternet) {
        // 1) flush mutaciones pendientes
        flushQueue().then((n) => {
          if (n > 0) console.info(`[sync-queue] ${n} mutaciones aplicadas tras reconexión`);
        }).catch(() => {});
        // 2) re-pull playlists/library para alinearse con el servidor
        loadPlaylists();
        loadLibrary();
        // 3) flush historial pendiente de plays offline
        useHistoryStore.getState().flushOffline().catch(() => {});
      }
      if (recoveredDesktop) {
        console.info(`[connectivity] desktop alcanzable (source=${s.source})`);
        // Forzar refresh de búsqueda y previews — el cambio de fuente
        // queda reflejado automáticamente en futuras llamadas a
        // getReachableLanBaseUrl/resolveAudioSource.
      }
    });
  }, [user, loadPlaylists, loadLibrary]);

  // PWA: observa la URL pública del tunnel del usuario en Supabase y la
  // refresca en localStorage automáticamente. Resuelve Quick Tunnels que
  // cambian de URL en cada arranque del desktop.
  useEffect(() => {
    if (!user || isDesktop) return;
    const unsub = subscribeTunnelUrl(user.id, () => {
      forceRecheck();
    });
    return unsub;
  }, [user]);

  // Desktop: publica/borra la URL del tunnel + access token en Supabase
  // para que la PWA del mismo usuario reconecte sin pasos manuales,
  // incluso si su localStorage fue evictado por el navegador.
  useEffect(() => {
    if (!user || !isDesktop) return;
    /** @type {string|null} */
    let lastPublished = null;
    let cachedToken = null;
    // Obtenemos el access token del main process una sola vez.
    api.appInfo().then((info) => { cachedToken = info?.accessToken ?? null; }).catch(() => {});

    const unsub = api.tunnelOnState?.((st) => {
      const url = st?.url ?? null;
      if (st?.status === 'connected' && url && url !== lastPublished) {
        lastPublished = url;
        const source = /\.trycloudflare\.com$/.test(url) ? 'quick'
                     : /\.cfargotunnel\.com$/.test(url) ? 'named'
                     : 'custom';
        publishTunnelUrl(user.id, url, source, cachedToken);
      } else if (st?.status === 'idle' && lastPublished) {
        lastPublished = null;
        clearTunnelUrl(user.id);
      }
    });
    return () => { try { unsub?.(); } catch {} };
  }, [user]);

  // Motor de audio activo siempre que haya sesión
  usePlayerEngine();
  // Atajos de teclado globales — activos en desktop y en PWA con teclado
  // fisico conectado. Internamente ignoran eventos desde campos editables
  // y cuando hay un BottomSheet abierto.
  useGlobalShortcuts();

  if (loading) {
    return (
      <div className={styles.boot}>
        <img src={logotipoUrl} alt="Ritmiq" className={styles.bootLogo} />
        <span className={styles.bootHint}>Cargando…</span>
      </div>
    );
  }
  if (!user) {
    return <AuthScreen />;
  }

  return (
    <div className={styles.shell} data-queue-open={queueOpen} data-nowplaying-open={nowPlayingOpen}>
      <aside className={styles.sidebar} data-mobile-open={sidebarOpen}>
        <Sidebar />
      </aside>
      <div
        className={styles.scrim}
        data-visible={sidebarOpen}
        onClick={closeSidebar}
        aria-hidden="true"
      />
      {/* TopBar como modulo flotante independiente — fila propia del grid,
          ocupa solo la columna central. Oculta en mobile (cada view tiene
          su propio header). */}
      <header className={styles.topbar}>
        <TopBar />
      </header>
      <main className={styles.main}>
        <MainView />
      </main>
      <aside className={styles.queue}>
        <QueueOutlet />
      </aside>
      {/* NowPlaying side panel — en desktop renderiza dentro del grid-area
          nowplaying (panel flotante derecho); en mobile el propio componente
          se ocupa de mostrarse como modal fullscreen via su CSS. Renderizamos
          el componente tanto dentro como afuera del grid:
            - dentro del <aside>: para que el panel desktop ocupe la columna
              correctamente y herede el grid layout.
            - Como el CSS del NowPlaying mobile es position:fixed inset:0,
              en mobile el aside no contribuye visualmente (grid-area
              nowplaying esta a 0px en mobile).
       */}
      <aside className={styles.nowplayingPanel}>
        <NowPlaying />
      </aside>
      <footer className={styles.player}>
        <Player />
      </footer>
      <BottomNav />
      <DownloadProgress />
      {/* Render unico de todos los bottom sheets globales — controlados
          por el store useBottomSheet. Ver BottomSheetHost.jsx. */}
      <BottomSheetHost />
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
  // Una `key` única por vista hace que React remonte y dispare la animación
  // CSS de entrada (`ritmiq-fade-in-up` en `.main > *`) en cada navegación.
  let key = view.kind;
  if (view.kind === 'playlist') key = `playlist:${view.playlistId}`;
  else if (view.kind === 'search') key = `search:${view.query}`;
  else if (view.kind === 'artist') key = `artist:${view.name}`;
  else if (view.kind === 'album') key = `album:${view.artist}::${view.album}`;
  let content;
  if (view.kind === 'home') content = <Home />;
  else if (view.kind === 'library') content = <Library />;
  else if (view.kind === 'downloads') content = <Downloads />;
  else if (view.kind === 'account') content = <AccountView />;
  else if (view.kind === 'playlist') content = <PlaylistView playlistId={view.playlistId} />;
  else if (view.kind === 'search') content = <SearchView query={view.query} />;
  else if (view.kind === 'artist') content = <ArtistView name={view.name} />;
  else if (view.kind === 'album') content = <AlbumView artist={view.artist} album={view.album} />;
  else return null;
  return <div key={key} className={styles.viewSlot}>{content}</div>;
}
