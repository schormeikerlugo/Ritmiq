import { useEffect, useRef, useState } from 'react';
import { useLibraryStore } from '../../stores/library.js';
import { usePlayerStore } from '../../stores/player.js';
import { useAuthStore } from '../../stores/auth.js';
import { useViewStore } from '../../stores/view.js';
import { api, isDesktop } from '../../lib/api.js';
import { metaToCandidate } from '../../lib/track-helpers.js';
import { onConnectivityChange } from '../../lib/connectivity.js';
import { onQueueSizeChange } from '../../lib/sync-queue.js';
import { prewarmStream } from '../../lib/lan-client.js';
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);
  const reqRef = useRef(0);

  const setCurrent     = usePlayerStore((s) => s.setCurrent);
  const patch          = usePlayerStore((s) => s.patch);

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
      setOpen(false);
      setBusy(false);
      return;
    }

    const myReq = ++reqRef.current;
    let cancelled = false;

    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const items = await api.ytSearch(q);
        if (cancelled || reqRef.current !== myReq) return;
        setResults(items);
        setOpen(true);
        // Pre-calentar el cache del LAN server con los 3 primeros resultados,
        // así si el usuario pulsa play en cualquiera de ellos comienza al
        // instante en lugar de esperar 2-5s de yt-dlp.
        if (!isDesktop) {
          for (const it of items.slice(0, 3)) {
            if (it?.id) prewarmStream(it.id);
          }
        }
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
  }, [value]);

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
    else if (results[0]) pickResult(results[0]);
  };

  // Click en resultado → reproducir SIN guardar.
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
    setOpen(false);
    setCurrent(candidate);
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
          onFocus={() => results.length && setOpen(true)}
          placeholder="Busca canciones, artistas o pega un link de YouTube…"
          disabled={busy && !value}
          autoComplete="off"
        />
        {busy && <span className={styles.spinner} aria-hidden="true" />}

        {open && (results.length > 0) && (
          <ul className={styles.dropdown}>
            {results.map((r) => (
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
                    <span className={styles.itemTitle}>{r.title}</span>
                    <span className={styles.itemArtist}>
                      {r.uploader ?? '—'}
                      {r.duration ? ` · ${fmtDur(r.duration)}` : ''}
                    </span>
                  </div>
                </button>
              </li>
            ))}
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
