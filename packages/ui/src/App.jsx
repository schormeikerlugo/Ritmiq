import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar.jsx';
import { Library } from './components/Library/Library.jsx';
import { Home } from './components/Home/Home.jsx';
import { Downloads } from './components/Downloads/Downloads.jsx';
import { PlaylistView } from './components/PlaylistView/PlaylistView.jsx';
import { SearchView } from './components/SearchView/SearchView.jsx';
import { Player } from './components/Player/Player.jsx';
import { TopBar } from './components/TopBar/TopBar.jsx';
import { BottomNav } from './components/BottomNav/BottomNav.jsx';
import { DownloadProgress } from './components/DownloadProgress/DownloadProgress.jsx';
import { MilestoneToast } from './components/MilestoneToast/MilestoneToast.jsx';
import { DailyStreakToast } from './components/DailyStreakToast/DailyStreakToast.jsx';
import { ToastHost } from './components/Toast/ToastHost.jsx';
import { QueuePanel } from './components/QueuePanel/QueuePanel.jsx';
import { NowPlaying } from './components/NowPlaying/NowPlaying.jsx';
import { BottomSheetHost } from './components/BottomSheet/BottomSheetHost.jsx';
import { SharedView } from './components/SharedView/SharedView.jsx';
import { TrackRowSkeleton } from './components/Skeleton/index.js';

// ── Auth + Onboarding lazy (Fase 7.2) ─────────────────────────────────
// El 99% de las sesiones empiezan con usuario YA logueado: el codigo
// de signin/signup/reset password (~958 lineas de jsx + CSS) NO se usa
// pero se descargaba en el bundle inicial. Lo separamos:
//
//   AuthScreen + sus 4 views (Sign{In,Up}, Forgot/ResetPassword)
//   ResetPasswordView (caso recovery flow)
//   Onboarding (3 pasos al primer login por device, una sola vez en
//   la vida del usuario en este device)
//
// Fallback para los 3: null. El splash inline del index.html aun esta
// presente cuando React monta por primera vez; al detectar !user el
// chunk Auth se descarga (~50-200ms) y luego React lo monta encima.
// Para el usuario es indistinguible del comportamiento previo.
const AuthScreen = lazy(() => import('./components/Auth/AuthScreen.jsx')
  .then((m) => ({ default: m.AuthScreen })));
const ResetPasswordView = lazy(() => import('./components/Auth/views/ResetPasswordView.jsx')
  .then((m) => ({ default: m.ResetPasswordView })));
const Onboarding = lazy(() => import('./components/Onboarding/Onboarding.jsx')
  .then((m) => ({ default: m.Onboarding })));

// ── Code-splitting por ruta (Fase 7.1) ────────────────────────────────
// Vistas de uso frecuente o always-mounted quedan en el bundle inicial
// (arriba). Las menos frecuentes / mas pesadas se lazy-load: cada una
// se baja en su propio chunk cuando el user navega a esa vista por
// primera vez en la sesion. Vite emite un /assets/<Name>-<hash>.js
// independiente por cada dynamic import().
//
// Suspense fallback: un TrackRowSkeleton breve (la mayoria de chunks
// pesan < 50 KB y bajan en < 200ms en red estable).
const SettingsView   = lazy(() => import('./components/SettingsView/SettingsView.jsx')
  .then((m) => ({ default: m.SettingsView })));
const StatsView      = lazy(() => import('./components/StatsView/StatsView.jsx')
  .then((m) => ({ default: m.StatsView })));
const FriendsView    = lazy(() => import('./components/FriendsView/FriendsView.jsx')
  .then((m) => ({ default: m.FriendsView })));
const ProfileView    = lazy(() => import('./components/ProfileView/ProfileView.jsx')
  .then((m) => ({ default: m.ProfileView })));
const HistoryView    = lazy(() => import('./components/HistoryView/HistoryView.jsx')
  .then((m) => ({ default: m.HistoryView })));
const ArtistView     = lazy(() => import('./components/ArtistView/ArtistView.jsx')
  .then((m) => ({ default: m.ArtistView })));
const AlbumView      = lazy(() => import('./components/AlbumView/AlbumView.jsx')
  .then((m) => ({ default: m.AlbumView })));
const YtPlaylistView = lazy(() => import('./components/YtPlaylistView/YtPlaylistView.jsx')
  .then((m) => ({ default: m.YtPlaylistView })));

// MonthlyWrappedAutoTrigger: invisible la mayoria del tiempo (solo
// abre modal una vez al mes), perfecto candidate a chunk separado.
const MonthlyWrappedAutoTrigger = lazy(() => import('./components/StatsView/MonthlyWrapped.jsx')
  .then((m) => ({ default: m.MonthlyWrappedAutoTrigger })));
import {
  parseShareFromUrl, clearShareFromUrl,
  isStandalonePWA, markPwaInstalled, pingMarkInstalled,
} from './lib/share.js';
import { usePlayerStore } from './stores/player.js';
import { metaToCandidate } from './lib/track-helpers.js';
import logotipoUrl from './assets/logotipo.png';
import { useAuthStore } from './stores/auth.js';
import { supabase } from './lib/supabase.js';
import { useLibraryStore } from './stores/library.js';
import { usePlaylistsStore } from './stores/playlists.js';
import { useHistoryStore } from './stores/history.js';
import { useRecommendationsStore } from './stores/recommendations.js';
import { useArtistStore } from './stores/artist.js';
import { useSearchStore } from './stores/search.js';
import { useViewStore } from './stores/view.js';
import { usePlayerEngine } from './lib/use-player.js';
import { useGlobalShortcuts } from './lib/use-shortcuts.js';
import { useShortcutsOnboarding } from './lib/use-shortcuts-onboarding.js';
import { useDesktopNotifications } from './lib/use-desktop-notifications.js';
import { useRadioAutoExtend } from './lib/use-radio.js';
import { useCrossfade } from './lib/use-crossfade.js';
import { useApplyAudioSettings } from './lib/use-apply-audio-settings.js';
import { useJamSync } from './lib/use-jam-sync.js';
import { useSocialStore } from './stores/social.js';
import { usePresence } from './lib/use-presence.js';
import { useSocialRealtime } from './lib/use-social-realtime.js';
import { useShareReminder } from './lib/use-share-reminder.js';
import { ShareReminderModal } from './components/ShareReminder/ShareReminderModal.jsx';
import { usePushRegistration } from './lib/use-push.js';
import { useViewTransition } from './lib/use-view-transition.js';
import { useAppBadge } from './lib/use-badge.js';
import { useSettingsStore } from './stores/settings.js';
import { initTheme } from './stores/theme.js';

// Aplica el tema guardado en localStorage al <html> ANTES del primer render.
// Idempotente — si ya estaba aplicado por otro modulo, no hace nada nuevo.
initTheme();

// Si la app arranca en modo PWA standalone, marca un flag en localStorage
// Y llama al endpoint /api/mark-installed para setear una cookie de primer
// origen. En iOS, localStorage es SEGREGADO entre Safari y la PWA standalone,
// pero las cookies del mismo origen SI se comparten — esto permite que la
// SharedView en Safari detecte correctamente si el device ya tiene la PWA.
//
// El listener de visibilitychange (registrado dentro del componente App)
// refresca la cookie cuando la PWA pasa de hidden→visible, throttled a una
// vez por dia. Esto cubre el caso de la cookie expirando (Max-Age 1 ano) o
// del usuario limpiando cookies — T5 del roadmap.
if (isStandalonePWA()) {
  markPwaInstalled();
  // Force=true en boot para garantizar al menos un ping al arrancar la PWA,
  // ignorando el throttle. Las llamadas siguientes (visibilitychange) si lo
  // respetan.
  pingMarkInstalled({ force: true });
}
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

// Parsea el query param `?share=...` al cargar el modulo — solo una vez.
// Si encuentra un share valido se renderiza la landing publica antes que
// cualquier otra UI. Cuando el usuario hace login y el share esta presente,
// el track se anade a la cola y el param se limpia de la URL.
const initialShare = parseShareFromUrl();

// Detecta si el usuario llega via link de recovery de password.
// Supabase mete el access_token en el hash con type=recovery.
function detectRecoveryFromUrl() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hash ?? '';
  if (h.includes('type=recovery')) return true;
  if (h.startsWith('#reset-password')) return true;
  return false;
}

export function App() {
  const { user, loading, init } = useAuthStore();
  const [share, setShare] = useState(initialShare);
  const [recoveryMode, setRecoveryMode] = useState(detectRecoveryFromUrl);
  const loadLibrary = useLibraryStore((s) => s.load);
  const resetLibrary = useLibraryStore((s) => s.reset);
  const loadPlaylists = usePlaylistsStore((s) => s.load);
  const resetPlaylists = usePlaylistsStore((s) => s.reset);
  const queueOpen = useViewStore((s) => s.queueOpen);
  const sidebarOpen = useViewStore((s) => s.sidebarOpen);
  const closeSidebar = useViewStore((s) => s.closeSidebar);
  const nowPlayingOpen = useViewStore((s) => s.nowPlayingOpen);
  const viewKind = useViewStore((s) => s.view.kind);

  // Presencia "Escuchando ahora" — publica el track actual a los amigos.
  const eqEnabled    = useSettingsStore((s) => s.eqEnabled);
  const showActivity = useSocialStore((s) => s.profile?.showActivity ?? true);
  usePresence(user?.id ?? null, showActivity);
  // Realtime social: presence de amigos, friendships, shared_items —
  // mantiene el store fresco sin recargar la pagina.
  useSocialRealtime(user?.id ?? null);
  // Recordatorio de shares no vistos — modal proactivo cuando un share
  // lleva >2min sin abrirse. Complementa el push (que puede ignorarse).
  useShareReminder(user?.id ?? null);
  // Web Push: si el usuario ya concedio el permiso, re-registra el endpoint
  // (los push endpoints expiran y se rotan; el upsert mantiene la fila viva).
  usePushRegistration(user?.id ?? null);

  // Badge nativo en el icono de la app (iOS PWA 16.4+, Android Chrome
  // instalada, desktop PWA). Se sincroniza con incomingRequests +
  // shares sin leer. Si el usuario esta viendo la pestana Amigos,
  // forzamos clearAppBadge() porque ya los esta viendo en pantalla
  // \u2014 mantener el badge rojo seria incoherente con su contexto.
  const incomingCount = useSocialStore((s) => s.incomingRequests.length);
  const unreadShares  = useSocialStore(
    (s) => s.inbox.filter((i) => !i.readAt).length,
  );
  const viewingFriends = viewKind === 'friends';
  useAppBadge(incomingCount + unreadShares, viewingFriends);

  // Inicializar sesión Supabase al montar
  useEffect(() => { init(); }, [init]);

  // T5 — Refresh periodico de la cookie /api/mark-installed.
  // Cuando la PWA standalone pasa de hidden→visible (usuario vuelve a la
  // app tras minimizarla o cambiar de tab/app), re-pingea el endpoint con
  // throttle de 24h. Mantiene la cookie viva en Safari iOS aunque el user
  // no abra la PWA standalone con frecuencia.
  // Solo registra el listener si estamos en standalone — en pestana del
  // navegador no aporta nada y solo gastaria ciclos.
  useEffect(() => {
    if (!isStandalonePWA()) return;
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // pingMarkInstalled respeta el throttle internamente.
        pingMarkInstalled();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Recovery flow: Supabase dispara onAuthStateChange con 'PASSWORD_RECOVERY'
  // cuando el user pulsa el link del email. Escuchamos directamente al cliente.
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      try {
        const { supabase } = await import('./lib/supabase.js');
        const { data } = supabase.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
        });
        unsub = () => data?.subscription?.unsubscribe?.();
      } catch { /* ignore */ }
    })();
    return () => unsub();
  }, []);

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
      // Sincronizar al main process el valor inicial del toggle de
      // cache global de URLs (Fase 1). Asi el lan-server respeta la
      // preferencia persistida del user desde el arranque.
      try {
        const enabled = useSettingsStore.getState().publishUrlCache;
        if (typeof window !== 'undefined' && window.ritmiq?.settings?.setPublishUrlCache) {
          window.ritmiq.settings.setPublishUrlCache(enabled).catch(() => {});
        }
      } catch {}
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

  // Desktop: sincronizar al main process el JWT del usuario autenticado
  // (Supabase access_token). Necesario para que publishToGlobalCache
  // pueda autenticarse contra la Edge publish-stream-url, que valida con
  // auth.getUser() y NO acepta el ANON_KEY.
  //
  // Push inicial al montar + suscripcion a onAuthStateChange (cubre login,
  // refresh automatico cada hora, logout). Al logout enviamos null para
  // que el main descarte el token (no publish hasta nueva sesion).
  useEffect(() => {
    if (!isDesktop) return;
    const push = (token) => {
      try {
        window.ritmiq?.settings?.setSupabaseToken?.(token ?? null);
      } catch {}
    };
    supabase.auth.getSession().then(({ data }) => {
      push(data?.session?.access_token ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      push(session?.access_token ?? null);
    });
    return () => { try { sub?.subscription?.unsubscribe?.(); } catch {} };
  }, []);

  // T5: refresca la cookie cross-context cada vez que la PWA vuelve a ser
  // visible, throttled a una vez por dia. Garantiza que la cookie no quede
  // stale si el usuario reinstala la PWA o cambia de device. Solo corre en
  // PWA standalone (no en desktop ni en Safari normal).
  useEffect(() => {
    if (!isStandalonePWA()) return;
    const THROTTLE_KEY = 'ritmiq.mark-installed-ts';
    const ONE_DAY_MS = 86_400_000;
    const handler = () => {
      if (document.visibilityState !== 'visible') return;
      const last = parseInt(localStorage.getItem(THROTTLE_KEY) ?? '0', 10);
      if (Date.now() - last < ONE_DAY_MS) return;
      localStorage.setItem(THROTTLE_KEY, String(Date.now()));
      fetch('/api/mark-installed', { method: 'POST', credentials: 'same-origin' })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Recargar biblioteca y playlists al cambiar el usuario
  useEffect(() => {
    if (user) {
      loadLibrary();
      loadPlaylists();
      useHistoryStore.getState().load();
      // Realtime sync de play_history para multidevice. Sin esto, si el
      // usuario reproduce en iPhone y luego abre la app en iPad/Desktop,
      // el segundo device ve un snapshot viejo de events y la racha
      // aparece DISMINUIDA. La suscripcion mantiene events sincronizados
      // entre todos los devices del mismo user en tiempo real.
      useHistoryStore.getState().subscribeRealtime(user.id);
      // Snapshot autoritativo desde user_streaks (BD) + lista de trofeos
      // desbloqueados desde streak_milestones. Sobrevive a reinstall de
      // la app: la racha se ve en el primer render sin necesidad de
      // esperar al load() paginado de play_history.
      useHistoryStore.getState().loadStreakSnapshot(user.id).then(() => {
        // Welcome milestone: tras hidratar la lista de trofeos, mostrar
        // al user el de mayor nivel desbloqueado como saludo. Con un
        // delay para no chocar con el splash/login y dar tiempo al
        // primer render. Idempotente por sesion (flag _welcomeShown).
        setTimeout(() => {
          try { useHistoryStore.getState().showWelcomeMilestone(); } catch {}
        }, 1500);
      });
      useHistoryStore.getState().subscribeStreak(user.id);
      // Cargar el perfil social a nivel App para que este disponible
      // en todas las vistas (Home, TopBar, BottomNav, AccountInfoView)
      // sin tener que abrir FriendsView primero. Antes este load solo
      // ocurria al montar FriendsView — en desktop, si el usuario nunca
      // entraba a Amigos, profile quedaba null y el dialog de editar
      // perfil no funcionaba.
      useSocialStore.getState().loadProfile(user.id);
    } else {
      resetLibrary();
      resetPlaylists();
      useSocialStore.getState().reset();
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

  // Si hay un share pendiente Y el user ya esta autenticado, cargamos el
  // track al player y limpiamos el path/query de la URL. Se ejecuta una
  // sola vez por share — el setShare(null) evita re-disparos.
  useEffect(() => {
    if (!user || !share || share.type !== 'track') return;
    const candidate = metaToCandidate({
      id: share.ytId,
      title: share.title ?? 'Track compartido',
      uploader: share.artist ?? '',
      thumbnail: share.coverUrl ?? '',
      duration: null,
    });
    usePlayerStore.getState().setCurrent(candidate);
    usePlayerStore.getState().patch({ isPlaying: true, positionSeconds: 0 });
    clearShareFromUrl();
    setShare(null);
  }, [user, share]);

  // Motor de audio activo siempre que haya sesión
  const backend = usePlayerEngine();
  // Atajos de teclado globales — activos en desktop y en PWA con teclado
  // fisico conectado. Internamente ignoran eventos desde campos editables
  // y cuando hay un BottomSheet abierto.
  useGlobalShortcuts();
  // Onboarding toast first-time: avisa al user que ? abre la lista de
  // atajos. Solo se muestra una vez por device, solo en desktop/PWA con
  // teclado fisico probable. Persistido en localStorage.
  useShortcutsOnboarding(user?.id ?? null);
  // Notificaciones nativas del SO al cambiar pista — solo desktop y solo
  // cuando la ventana no esta enfocada (evita spam si el user mira la app).
  useDesktopNotifications();
  // Modo Radio — auto-extiende la cola con tracks de la lib cuando quedan
  // pocas por delante y radioMode esta activo. Idle si radioMode=false.
  useRadioAutoExtend();
  // Crossfade en cambios manuales de track (Sprint γ — F2.8). Idle si
  // settings.crossfadeSeconds === 0.
  useCrossfade(backend);
  // Aplica settings de EQ al backend cuando cambian en el store. Lazy:
  // si el usuario nunca toca el EQ, no inicializa el WebAudio graph.
  useApplyAudioSettings(backend);
  // Bridge entre useJamStore y usePlayerStore (Fase 8.3):
  //   - hosting: broadcast cambios del player al jam_sessions row.
  //   - guest: aplica el state del jam al player local.
  // No-op si mode === "idle".
  useJamSync();

  // Si llega via link compartido Y aun no esta logueado, mostrar landing
  // publica. Click en "Abrir Ritmiq" cierra share view → flujo normal de
  // login → al login completo, el useEffect de abajo aplica el share.
  if (share && !user && !loading) {
    return (
      <SharedView
        share={share}
        isAuthed={false}
        onOpenInApp={() => setShare(null)}
      />
    );
  }

  if (loading) {
    return (
      <div className={styles.boot}>
        <img src={logotipoUrl} alt="Ritmiq" className={styles.bootLogo} />
        <span className={styles.bootHint}>Cargando…</span>
      </div>
    );
  }
  // Recovery flow tiene prioridad sobre login normal: el user ya tiene
  // sesion temporal (Supabase la crea automaticamente al validar el link).
  // Suspense fallback null: el splash inline del index.html sigue visible
  // durante la descarga del chunk Auth.
  if (recoveryMode) {
    return (
      <Suspense fallback={null}>
        <ResetPasswordView />
      </Suspense>
    );
  }
  if (!user) {
    return (
      <Suspense fallback={null}>
        <AuthScreen />
      </Suspense>
    );
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
      <main className={styles.main} data-view={viewKind}>
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
      {/* Onboarding 3 pasos al primer login en cada dispositivo. Se
          auto-cierra y persiste el flag de completado en localStorage.
          Lazy: el componente decide internamente si renderizar (lee el
          flag). Cuando devuelve null, el chunk NO se descarga. Cuando
          si renderiza (1 vez en la vida del user en este device), el
          chunk se baja con fallback null. */}
      <Suspense fallback={null}>
        <Onboarding />
      </Suspense>
      {/* Recordatorio: muestra shares no vistos >2min cuando el usuario
          no esta en la bandeja. Se auto-cierra al ignorar o ver. */}
      <ShareReminderModal />
      {/* Modal bloqueante con animacion epica cuando se desbloquea un
          hito de racha (3, 7, 14, 30, 50, 100, 200, 365, 500, 1000 dias)
          o de horas escuchadas (1, 10, 50, 100, 500, 1000, 5000h). */}
      <MilestoneToast />
      {/* Toast no bloqueante que celebra la racha diaria (cada dia que
          activas tu racha, una vez al dia, sincronizado cross-device
          via user_streaks.last_daily_celebrated_date). Intensidad y
          mensaje rotativo segun los dias acumulados. */}
      <DailyStreakToast />
      {/* Snackbars globales (feedback de acciones: añadir a favoritas,
          link copiado, share enviado, etc.). Stack vertical bottom-center
          en mobile, bottom-right en desktop. Auto-dismiss 3.5s. */}
      <ToastHost />
      {/* Auto-trigger del modal Wrapped: muestra resumen del mes anterior
          una vez por mes despues del dia 2. Persiste flag en localStorage.
          Lazy: el componente decide internamente si renderizar; cuando es
          null no descarga el chunk. Cuando si decide abrir, Suspense
          fallback null porque el modal va sobre un overlay que ya tiene
          su propio loading state. */}
      <Suspense fallback={null}>
        <MonthlyWrappedAutoTrigger />
      </Suspense>
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
  // Una `key` única por vista hace que React remonte y dispare la
  // transicion de entrada via useViewTransition (GSAP) en ViewSlot.
  let key = view.kind;
  if (view.kind === 'playlist') key = `playlist:${view.playlistId}`;
  else if (view.kind === 'ytPlaylist') key = `ytPlaylist:${view.ytPlaylistId}`;
  else if (view.kind === 'search') key = `search:${view.query}`;
  else if (view.kind === 'artist') key = `artist:${view.name}`;
  else if (view.kind === 'album') key = `album:${view.artist}::${view.album}`;

  // Resetear scroll del contenedor principal al cambiar de vista.
  // El <main className={styles.main}> NO se remonta entre vistas (solo
  // su hijo .viewSlot via key); su scrollTop persiste si no lo
  // reseteamos manualmente. Sin esto el usuario lleva a la siguiente
  // vista la posicion de scroll de la anterior — mal UX.
  //
  // Tambien reseteamos contenedores de scroll interno: FriendsView
  // (.content) y ProfileView (.body) tienen overflow propio porque sus
  // headers son sticky-like. Buscamos cualquier elemento con el atributo
  // data-scroll-reset='true' dentro del slot recien renderizado.
  useEffect(() => {
    const main = document.querySelector(`.${styles.main}`);
    if (main && main.scrollTop > 0) {
      // scrollTop = 0 directo (en vez de scrollTo({behavior:'instant'}))
      // porque el CSS tiene scroll-behavior: smooth y queremos teleport
      // inmediato al cambiar de vista, no animar el scroll de vuelta al top.
      // Asignar scrollTop directamente bypasea el behavior CSS.
      main.scrollTop = 0;
    }
    // Resetear contenedores internos marcados con data-scroll-reset
    // (FriendsView, ProfileView tienen overflow propio).
    document
      .querySelectorAll('[data-scroll-reset="true"]')
      .forEach((el) => { if (el.scrollTop > 0) el.scrollTop = 0; });
  }, [key]);

  let content;
  let isLazy = false;
  if (view.kind === 'home') content = <Home />;
  else if (view.kind === 'library') content = <Library />;
  else if (view.kind === 'downloads') content = <Downloads />;
  else if (view.kind === 'settings') { content = <SettingsView />; isLazy = true; }
  else if (view.kind === 'stats') { content = <StatsView />; isLazy = true; }
  else if (view.kind === 'friends') { content = <FriendsView />; isLazy = true; }
  else if (view.kind === 'profile') { content = <ProfileView userId={view.userId} />; isLazy = true; }
  else if (view.kind === 'playlist') content = <PlaylistView playlistId={view.playlistId} />;
  else if (view.kind === 'ytPlaylist') { content = <YtPlaylistView id={view.ytPlaylistId} />; isLazy = true; }
  else if (view.kind === 'search') content = <SearchView query={view.query} />;
  else if (view.kind === 'artist') { content = <ArtistView name={view.name} />; isLazy = true; }
  else if (view.kind === 'album') { content = <AlbumView artist={view.artist} album={view.album} />; isLazy = true; }
  else if (view.kind === 'history') { content = <HistoryView />; isLazy = true; }
  else return null;

  // Suspense wraps SOLO las vistas lazy. Las eager no lo necesitan y
  // anadir un Suspense innecesario hace que React inserte un boundary
  // que sutilmente cambia el comportamiento del reconciler.
  if (isLazy) {
    content = (
      <Suspense fallback={<TrackRowSkeleton count={6} />}>
        {content}
      </Suspense>
    );
  }
  return <ViewSlot key={key}>{content}</ViewSlot>;
}

/**
 * ViewSlot — wrapper de la vista activa con transicion de entrada GSAP.
 *
 * Se remonta en cada cambio de `key` (kind/id de la view), lo que dispara
 * useViewTransition con preset 'fadeUp'. El hook respeta automaticamente
 * prefers-reduced-motion via gsap.matchMedia.
 *
 * Se mantiene como componente separado (en vez de inline en MainView) para
 * que el ref tenga ciclo de vida limpio: mount al asignar new key, unmount
 * al cambiar. ctx.revert() limpia los tweens del slot saliente.
 */
function ViewSlot({ children }) {
  const ref = useRef(null);
  useViewTransition(ref, { preset: 'fadeUp' });
  return <div ref={ref} className={styles.viewSlot}>{children}</div>;
}
