import { useEffect, useMemo, useRef, useState } from 'react';
import { useLibraryStore } from '../../stores/library.js';
import { usePlayerStore } from '../../stores/player.js';
import { useAuthStore } from '../../stores/auth.js';
import { useViewStore } from '../../stores/view.js';
import { api, isDesktop } from '../../lib/api.js';
import { metaToCandidate } from '../../lib/track-helpers.js';
import { onConnectivityChange } from '../../lib/connectivity.js';
import { onQueueSizeChange } from '../../lib/sync-queue.js';
import { prewarmStream, checkSharedCache } from '../../lib/lan-client.js';
import { searchLibraryTracks, dedupeByYtId } from '../../lib/library-search.js';
import { SettingsDialog } from '../SettingsDialog/SettingsDialog.jsx';
import { Icon } from '../Icon/Icon.jsx';
import styles from './TopBar.module.css';

const URL_OR_ID_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})|^[\w-]{11}$/;

function fmtDur(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

export function TopBar() {
  const [value, setValue] = useState('');
  const [results, setResults] = useState([]);
  const [localMatches, setLocalMatches] = useState(/** @type {import('@ritmiq/core/types').Track[]} */ ([]));
  const [cachedSet, setCachedSet] = useState(/** @type {Set<string>} */ (new Set()));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);
  const reqRef = useRef(0);

  const setCurrent     = usePlayerStore((s) => s.setCurrent);
  const patch          = usePlayerStore((s) => s.patch);
  const goSearch       = useViewStore((s) => s.goSearch);
  // Library en memoria — usada para matches locales antes de la busqueda
  // remota. Suscribimos directo al array de tracks; cualquier cambio en
  // la lib re-renderiza el dropdown si esta abierto.
  const libraryTracks  = useLibraryStore((s) => s.tracks);

  // Resultados YouTube ordenados: primero los que tienen ⚡ cache HIT en
  // el desktop (reproduccion instantanea), despues el resto en su orden
  // original. Sort estable: la posicion relativa dentro de cada grupo
  // se preserva.
  const sortedResults = useMemo(() => {
    if (cachedSet.size === 0) return results;
    const cached = [];
    const others = [];
    for (const r of results) {
      if (cachedSet.has(r.id)) cached.push(r);
      else others.push(r);
    }
    return [...cached, ...others];
  }, [results, cachedSet]);

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Debounce de búsqueda
  useEffect(() => {
    const q = value.trim();
    setError(null);

    // Si vacío o es URL/ID directa, limpiar y salir
    if (!q || URL_OR_ID_RE.test(q)) {
      reqRef.current++;       // invalidar cualquier petición en curso
      setResults([]);
      setLocalMatches([]);
      setCachedSet(new Set());
      setOpen(false);
      setBusy(false);
      return;
    }

    // LOCAL-FIRST: matches contra la biblioteca al instante (sin debounce
    // ni network). Se muestran encima de los resultados YouTube tan pronto
    // el user tipea, dando feedback inmediato si la cancion ya esta en su
    // libreria.
    const local = searchLibraryTracks(libraryTracks, q, 5);
    setLocalMatches(local);
    if (local.length > 0) setOpen(true);

    const myReq = ++reqRef.current;
    let cancelled = false;

    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const items = await api.ytSearch(q);
        if (cancelled || reqRef.current !== myReq) return;
        // Dedupe: filtra videos cuyo ytId ya esta en la lib (no duplicar).
        const filtered = dedupeByYtId(items, local);
        setResults(filtered);
        setOpen(true);
        // Pre-calentar el cache del LAN server con los 3 primeros resultados,
        // así si el usuario pulsa play en cualquiera de ellos comienza al
        // instante en lugar de esperar 2-5s de yt-dlp.
        if (!isDesktop) {
          for (const it of filtered.slice(0, 3)) {
            if (it?.id) prewarmStream(it.id);
          }
        }
        // Chequeo bulk: cuales de estos ytIds ya estan en shared_audio?
        // Aparece badge "En cache" → reproducibles al instante sin yt-dlp.
        // Fire-and-forget; el setState se ignora si la busqueda fue
        // invalidada (myReq cambio).
        checkSharedCache(filtered.map((it) => it.id)).then((set) => {
          if (cancelled || reqRef.current !== myReq) return;
          setCachedSet(set);
        }).catch(() => {});
      } catch (err) {
        if (cancelled || reqRef.current !== myReq) return;
        setError(String(err));
      } finally {
        if (!cancelled && reqRef.current === myReq) setBusy(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, libraryTracks]);

  const submitUrl = async () => {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    try {
      // Pegar URL/ID: solo obtenemos metadata y reproducimos como efímero.
      const meta = await api.ytMetadata(v);
      const candidate = metaToCandidate(meta);
      setValue('');
      setOpen(false);
      setCurrent(candidate);
      patch({ isPlaying: true, positionSeconds: 0 });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (URL_OR_ID_RE.test(value.trim())) submitUrl();
    else if (localMatches[0]) pickLocal(localMatches[0]);
    else if (results[0]) pickResult(results[0]);
  };

  // Click en resultado de YouTube → reproducir SIN guardar (efimero).
  const pickResult = (item) => {
    // Prewarm explícito en PWA: aunque el server haya prewarmeado los top-3
    // tras el search, el usuario puede pulsar uno fuera de ese top o haber
    // hecho clic antes de que el prewarm en background terminara. Disparar
    // /yt/prewarm en paralelo a la transición de UI nos asegura que cuando
    // <audio> haga el primer Range request la URL ya esté cacheada.
    if (!isDesktop && item?.id) prewarmStream(item.id);
    const candidate = metaToCandidate(item);
    setValue('');
    setResults([]);
    setLocalMatches([]);
    setOpen(false);
    setCurrent(candidate);
    patch({ isPlaying: true, positionSeconds: 0 });
  };

  // Click en match LOCAL → reproduce el track tal cual (con su UUID real).
  // Sin metaToCandidate (no es efimero). El player resuelve via /stream/
  // que hara cache HIT en shared_audio si esta descargado.
  const pickLocal = (track) => {
    setValue('');
    setResults([]);
    setLocalMatches([]);
    setOpen(false);
    setCurrent(track);
    patch({ isPlaying: true, positionSeconds: 0 });
  };

  const toggleSidebar = useViewStore((s) => s.toggleSidebar);

  return (
    <div className={styles.bar} ref={wrapRef}>
      <button
        type="button"
        className={styles.menuBtn}
        onClick={toggleSidebar}
        aria-label="Menú"
      ><Icon name="Menu" size={22} /></button>
      <form className={styles.search} onSubmit={onSubmit}>
        <input
          className={styles.input}
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => (results.length || localMatches.length) && setOpen(true)}
          placeholder="Busca canciones, artistas o pega un link de YouTube…"
          disabled={busy && !value}
          autoComplete="off"
        />
        {busy && <span className={styles.spinner} aria-hidden="true" />}

        {open && (localMatches.length > 0 || results.length > 0) && (
          <ul className={styles.dropdown}>
            {/* ── Matches locales (lib del usuario) — arriba con badge ── */}
            {localMatches.length > 0 && (
              <li className={styles.sectionHeader} aria-hidden="true">
                <Icon name="Heart" size={12} />
                <span>En tu biblioteca</span>
              </li>
            )}
            {localMatches.map((t) => (
              <li key={`local-${t.id}`}>
                <button
                  type="button"
                  className={styles.item}
                  onClick={() => pickLocal(t)}
                >
                  <div className={styles.thumb}>
                    {t.coverUrl
                      ? <img src={t.coverUrl} alt="" />
                      : <Icon name="Music" size={16} />}
                  </div>
                  <div className={styles.itemMeta}>
                    <span className={styles.itemTitle}>
                      {t.title}
                      {t.isDownloaded && (
                        <span className={styles.badgeLocal} title="Descargada">
                          <Icon name="Download" size={10} />
                        </span>
                      )}
                    </span>
                    <span className={styles.itemArtist}>
                      {t.artist ?? '—'}
                      {t.durationSeconds ? ` · ${fmtDur(t.durationSeconds)}` : ''}
                    </span>
                  </div>
                  <span className={styles.badgeYours}>Tuya</span>
                </button>
              </li>
            ))}

            {/* ── Resultados de YouTube ──────────────────────────── */}
            {results.length > 0 && localMatches.length > 0 && (
              <li className={styles.sectionHeader} aria-hidden="true">
                <Icon name="Search" size={12} />
                <span>De YouTube</span>
              </li>
            )}
            {sortedResults.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={styles.item}
                  onClick={() => pickResult(r)}
                  // Adelantar el prewarm a "intención de click": apenas el
                  // usuario toca/pasa por encima del resultado disparamos
                  // /yt/prewarm para que cuando finalmente suelte el dedo
                  // (~150-300ms después en táctil), yt-dlp ya esté resuelto.
                  onPointerDown={() => { if (!isDesktop && r?.id) prewarmStream(r.id); }}
                  onTouchStart={() => { if (!isDesktop && r?.id) prewarmStream(r.id); }}
                >
                  <div className={styles.thumb}>
                    {r.thumbnail
                      ? <img src={r.thumbnail} alt="" />
                      : <Icon name="Music" size={16} />}
                  </div>
                  <div className={styles.itemMeta}>
                    <span className={styles.itemTitle}>
                      {r.title}
                      {cachedSet.has(r.id) && (
                        <span
                          className={styles.badgeCached}
                          title="En cache del PC — reproduccion instantanea"
                        >⚡</span>
                      )}
                    </span>
                    <span className={styles.itemArtist}>
                      {r.uploader ?? '—'}
                      {r.duration ? ` · ${fmtDur(r.duration)}` : ''}
                    </span>
                  </div>
                </button>
              </li>
            ))}
            {/* Estilo Spotify: enlace al final del dropdown para abrir la
                vista de búsqueda avanzada (canciones + artistas + playlists). */}
            <li>
              <button
                type="button"
                className={styles.viewAll}
                onClick={() => {
                  const q = value.trim();
                  if (!q) return;
                  setOpen(false);
                  setResults([]);
                  setValue('');
                  goSearch(q);
                }}
              >
                <Icon name="Search" size={14} />
                <span>Ver todos los resultados de “{value.trim()}”</span>
              </button>
            </li>
          </ul>
        )}

        {error && <span className={styles.error}>{error}</span>}
      </form>
      <UserMenu />
    </div>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conn, setConn] = useState({ internet: true, lan: false, tunnel: false, source: 'cloud' });
  const [pending, setPending] = useState(0);
  const online = conn.internet || conn.lan || conn.tunnel;
  const ref = useRef(null);
  const { user, signOut } = useAuthStore();

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => onConnectivityChange(setConn), []);
  useEffect(() => onQueueSizeChange(setPending), []);

  const initial = (user?.email ?? 'U').slice(0, 1).toUpperCase();
  const sourceLabel =
    conn.lan ? 'LAN'
    : conn.tunnel ? 'Tunnel'
    : conn.internet ? 'Nube'
    : 'Offline';
  const statusTitle = online
    ? `${sourceLabel}${pending > 0 ? ` · ${pending} cambios pendientes` : ''}`
    : `Sin conexión${pending > 0 ? ` · ${pending} cambios en cola` : ''}`;

  return (
    <div className={styles.actions} ref={ref}>
      <button
        className={styles.avatar}
        aria-label="Cuenta"
        onClick={() => setOpen((v) => !v)}
      >
        {initial}
        <span
          className={styles.statusDot}
          data-online={online}
          data-pending={pending > 0}
          aria-label={statusTitle}
          title={statusTitle}
        />
      </button>
      {open && (
        <div className={styles.userMenu}>
          <div className={styles.userEmail}>{user?.email}</div>
          <hr className={styles.userSep} />
          <button
            className={styles.userItem}
            onClick={() => { setOpen(false); setSettingsOpen(true); }}
          >{isDesktop ? 'Ajustes…' : 'Conexión con tu PC…'}</button>
          <button
            className={styles.userItem}
            onClick={() => { setOpen(false); signOut(); }}
          >Cerrar sesión</button>
        </div>
      )}
      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
