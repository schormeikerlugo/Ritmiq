/**
 * Vista fullscreen "Now Playing" estilo Spotify para mobile.
 *
 * - Slide-up animado al abrir, slide-down al cerrar.
 * - Swipe-down en el header cierra la vista.
 * - Background con gradiente del color dominante del cover → bg-0.
 * - Scrubber draggable que llama backend.seek() al soltar.
 * - Controles grandes: shuffle, prev, play/pause (64px), next, repeat.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { useLibraryStore } from '../../stores/library.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { isEphemeralTrack } from '../../lib/track-helpers.js';
import { getDominantColor } from '../../lib/dominant-color.js';
import { Icon } from '../Icon/Icon.jsx';
import { SaveDialog } from '../SaveDialog/SaveDialog.jsx';
import { EditTrackDialog } from '../EditTrackDialog/EditTrackDialog.jsx';
import { ArtistInfoPanel } from './ArtistInfoPanel.jsx';
import { useBottomSheet } from '../../stores/bottom-sheet.js';
import { buildShareLink, copyToClipboard } from '../../lib/share.js';
import { getSharedBackend } from '../../lib/use-player.js';
import { useBpmPulse } from '../../lib/use-bpm-pulse.js';
import { useWakeLock } from '../../lib/use-wake-lock.js';
import { hapticTap } from '../../lib/haptics.js';
import { useSocialStore } from '../../stores/social.js';
import { ShareToFriendModal } from '../ShareToFriendModal/ShareToFriendModal.jsx';
import styles from './NowPlaying.module.css';

function fmt(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function NowPlaying() {
  const open = useViewStore((s) => s.nowPlayingOpen);
  const close = useViewStore((s) => s.closeNowPlaying);
  const toggleQueue = useViewStore((s) => s.toggleQueue);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionSeconds = usePlayerStore((s) => s.positionSeconds);
  const durationSeconds = usePlayerStore((s) => s.durationSeconds);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const patch = usePlayerStore((s) => s.patch);

  const isFavorite = usePlaylistsStore((s) => s.isFavorite);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);
  const addTrack = usePlaylistsStore((s) => s.addTrack);
  const toggleFavorite = usePlaylistsStore((s) => s.toggleFavorite);
  const persistEphemeral = useLibraryStore((s) => s.persistEphemeral);

  const radioMode = usePlayerStore((s) => s.radioMode);
  const startRadio = usePlayerStore((s) => s.startRadio);

  // Mantener la pantalla encendida solo cuando NowPlaying esta abierto
  // Y hay reproduccion activa. El cover gigante + el scrubber + los
  // controles son la "vista cinema" \u2014 el usuario espera que no se
  // apague la pantalla. Cuando se pausa o se cierra el panel, se
  // libera el lock para no drenar bateria innecesariamente.
  //
  // iOS PWA 16.4+ soporta Screen Wake Lock. Sin instalar (browser tab)
  // no, pero el hook silenciosamente no hace nada \u2014 sin crash.
  useWakeLock(open && isPlaying);
  const stopRadio = usePlayerStore((s) => s.stopRadio);
  const openSheet = useBottomSheet((s) => s.open);

  // BPM-reactive pulse del cover. Solo activo cuando NowPlaying esta
  // visible (open === true) para no consumir CPU en idle. El primer
  // acceso a getAnalyser inicializa el WebAudio graph.
  const bpmScale = useBpmPulse(getSharedBackend(), open);

  const [bgColor, setBgColor] = useState('var(--color-bg-1)');
  const [closing, setClosing] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareToFriendOpen, setShareToFriendOpen] = useState(false);
  const friends = useSocialStore((s) => s.friends);
  /** Posición que muestra el scrubber mientras el usuario arrastra. null = no drag. */
  const [scrubPos, setScrubPos] = useState(null);

  const rootRef = useRef(null);
  const dragStateRef = useRef({ startY: 0, currentY: 0, dragging: false });

  // Extraer color dominante cuando cambia la cover.
  useEffect(() => {
    let cancelled = false;
    if (!currentTrack?.coverUrl) {
      setBgColor('var(--color-bg-1)');
      return;
    }
    getDominantColor(currentTrack.coverUrl).then((c) => {
      if (cancelled) return;
      setBgColor(c || 'var(--color-bg-1)');
    });
    return () => { cancelled = true; };
  }, [currentTrack?.coverUrl]);

  // Cerrar con ESC para desktop / teclado físico.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Bloquear scroll del body mientras está abierto.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const ephemeral = currentTrack ? isEphemeralTrack(currentTrack) : false;
  const fav = !!currentTrack && !ephemeral && isFavorite(currentTrack.id);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      close();
    }, 240);
  };

  const onHeart = async () => {
    if (!currentTrack) return;
    hapticTap();
    let id = currentTrack.id;
    if (ephemeral) {
      const persisted = await persistEphemeral(currentTrack);
      id = persisted.id;
    }
    if (favoritesId && !isFavorite(id)) await addTrack(favoritesId, id);
    else if (favoritesId) await toggleFavorite(id);
  };

  // Swipe-down: usar el header como handle.
  const onTouchStart = (e) => {
    const t = e.touches[0];
    if (!t) return;
    dragStateRef.current = { startY: t.clientY, currentY: t.clientY, dragging: true };
  };
  const onTouchMove = (e) => {
    const t = e.touches[0];
    if (!t || !dragStateRef.current.dragging) return;
    dragStateRef.current.currentY = t.clientY;
    const dy = Math.max(0, t.clientY - dragStateRef.current.startY);
    if (rootRef.current) {
      rootRef.current.style.transform = `translateY(${dy}px)`;
      rootRef.current.style.opacity = String(Math.max(0.5, 1 - dy / 600));
    }
  };
  const onTouchEnd = () => {
    if (!dragStateRef.current.dragging) return;
    const dy = dragStateRef.current.currentY - dragStateRef.current.startY;
    dragStateRef.current.dragging = false;
    if (rootRef.current) {
      rootRef.current.style.transform = '';
      rootRef.current.style.opacity = '';
    }
    if (dy > 100) handleClose();
  };

  // Scrubber: durante el drag, mostrar la posición local; al soltar, llamar seek
  // a través del store con patch (que sincroniza con el backend via use-player).
  const onScrubInput = (e) => {
    setScrubPos(Number(e.target.value));
  };
  const onScrubCommit = (e) => {
    const v = Number(e.target.value);
    setScrubPos(null);
    // Buscar el backend via window event — usamos un evento custom para no
    // crear dep cíclica con use-player. La store mantiene positionSeconds
    // como source of truth visual; el backend.seek lo aplica via el hook.
    patch({ positionSeconds: v });
    window.dispatchEvent(new CustomEvent('ritmiq:seek', { detail: { seconds: v } }));
  };

  const displayPos = scrubPos !== null ? scrubPos : positionSeconds;
  const dur = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;

  const background = useMemo(() => {
    const c = bgColor || 'var(--color-bg-1)';
    return `linear-gradient(180deg, ${c} 0%, var(--color-bg-0) 75%)`;
  }, [bgColor]);

  /** Comparte el track actual: genera link publico, copia al clipboard,
   *  y si la Share API esta disponible (mobile) abre el sheet nativo. */
  const shareCurrent = async () => {
    if (!currentTrack?.ytId) return;
    const link = buildShareLink(currentTrack);
    if (!link) return;
    // Web Share API (mobile principalmente) — bottom sheet nativo del SO.
    if (navigator?.share) {
      try {
        await navigator.share({
          title: currentTrack.title || 'Ritmiq',
          text: `${currentTrack.title}${currentTrack.artist ? ' — ' + currentTrack.artist : ''}`,
          url: link,
        });
        return;
      } catch {
        // user cancelo o no soportado → fallback a copiar
      }
    }
    const ok = await copyToClipboard(link);
    // Notificacion visual minima — toast manual via timeout. Reusamos el
    // patron del player error toast: dispatch via store.
    if (ok) {
      usePlayerStore.setState({ error: 'Link copiado al portapapeles' });
      setTimeout(() => {
        if (usePlayerStore.getState().error === 'Link copiado al portapapeles') {
          usePlayerStore.setState({ error: null });
        }
      }, 2000);
    }
  };

  /** Menu desplegable del boton `⋯`. Abre un bottom sheet con acciones
   *  rapidas — guardar, modo radio, compartir. Sleep timer se anadira
   *  aqui en F2.3. */
  // Abrir EditTrackDialog desde el "⋯". Si el track es efimero, lo
  // persistimos primero — updateMeta requiere que la cancion exista
  // en la biblioteca para tener algo que actualizar.
  const openEditDialog = async () => {
    if (!currentTrack) return;
    if (ephemeral) {
      try { await persistEphemeral(currentTrack); } catch { return; }
    }
    setEditOpen(true);
  };

  const openMoreMenu = () => {
    const closeSelf = () => useBottomSheet.getState().closeAll();
    const items = [
      {
        id: 'save',
        label: 'Guardar en biblioteca o playlist...',
        icon: 'Plus',
        onClick: () => { closeSelf(); setSaveOpen(true); },
      },
      {
        id: 'edit',
        label: 'Editar título y artista',
        icon: 'Pencil',
        disabled: !currentTrack?.ytId && !currentTrack?.id,
        onClick: () => { closeSelf(); openEditDialog(); },
      },
      {
        id: 'share',
        label: 'Compartir link...',
        icon: 'Share2',
        disabled: !currentTrack?.ytId,
        onClick: () => { closeSelf(); shareCurrent(); },
      },
      {
        id: 'share-friend',
        label: 'Compartir con amigo',
        icon: 'UserPlus',
        disabled: !currentTrack?.ytId || friends.length === 0,
        onClick: () => { closeSelf(); setShareToFriendOpen(true); },
      },
      radioMode
        ? {
            id: 'radio-stop',
            label: 'Detener modo Radio',
            icon: 'X',
            onClick: () => { closeSelf(); stopRadio(); },
          }
        : {
            id: 'radio-start',
            label: 'Iniciar modo Radio',
            icon: 'Disc3',
            onClick: () => { closeSelf(); startRadio(); },
            disabled: !currentTrack?.artist,
          },
    ];
    openSheet({
      title: 'Opciones',
      content: <MoreMenuBody items={items} />,
    });
  };

  if (!open && !closing) return null;

  // Cuando hay artista, envolvemos los controles principales en un wrapper
  // que ocupa casi todo el viewport (calc(100vh - 12vh)). Esto empuja el
  // ArtistInfoPanel justo despues del fold, dejando que asome solo ~10%
  // del titulo "Acerca del artista" como hint de scroll. Sin artista,
  // los controles fluyen naturalmente sin necesidad de min-height.
  const hasArtistPanel = !!currentTrack?.artist;

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-closing={closing}
      style={{ background }}
      role="dialog"
      aria-label="Reproductor"
    >
      <div
        className={styles.mainArea}
        data-with-panel={hasArtistPanel}
      >
      <header
        className={styles.header}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <button className={styles.headerBtn} onClick={handleClose} aria-label="Cerrar">
          <Icon name="ChevronDown" size={24} />
        </button>
        <div className={styles.headerTitle}>
          <span className={styles.eyebrow}>
            {radioMode ? (
              <>
                <Icon name="Disc3" size={11} /> Modo Radio
              </>
            ) : 'Reproduciendo'}
          </span>
          <span className={styles.context}>{currentTrack?.album || currentTrack?.artist || 'Ritmiq'}</span>
        </div>
        <button
          className={styles.headerBtn}
          aria-label="Más opciones"
          onClick={() => openMoreMenu()}
        >
          <Icon name="MoreHorizontal" size={22} />
        </button>
      </header>

      <div className={styles.coverWrap}>
        <div
          className={styles.cover}
          style={{ transform: `scale(${bpmScale.toFixed(3)})` }}
        >
          {currentTrack?.coverUrl
            ? <img src={currentTrack.coverUrl} alt="" />
            : <div className={styles.coverPlaceholder}><Icon name="Music" size={64} /></div>}
        </div>
      </div>

      <div className={styles.info}>
        <div className={styles.infoText}>
          <h1 className={styles.title}>{currentTrack?.title ?? '—'}</h1>
          <p className={styles.artist}>{currentTrack?.artist ?? '—'}</p>
        </div>
        <button
          className={styles.heartBtn}
          data-active={fav}
          onClick={onHeart}
          aria-label={fav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
        >
          <Icon name="Heart" filled={fav} size={26} />
        </button>
      </div>

      <div className={styles.scrubber}>
        <input
          type="range"
          min={0}
          max={dur || 1}
          step={1}
          value={displayPos}
          onChange={onScrubInput}
          onMouseUp={onScrubCommit}
          onTouchEnd={onScrubCommit}
          onKeyUp={onScrubCommit}
          disabled={!dur}
          aria-label="Posición de la canción"
          className={styles.scrubInput}
          style={{ '--pct': `${dur ? (displayPos / dur) * 100 : 0}%` }}
        />
        <div className={styles.times}>
          <span>{fmt(displayPos)}</span>
          <span>{fmt(dur)}</span>
        </div>
      </div>

      <div className={styles.controls}>
        <button
          className={styles.ctrlBtn}
          data-active={shuffle}
          onClick={toggleShuffle}
          aria-label="Aleatorio"
        >
          <Icon name="Shuffle" size={22} />
        </button>
        <button className={styles.ctrlBtn} onClick={prev} aria-label="Anterior">
          <Icon name="SkipBack" size={32} filled />
        </button>
        <button
          className={styles.playBtn}
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
        >
          <Icon name={isPlaying ? 'Pause' : 'Play'} size={28} filled />
        </button>
        <button className={styles.ctrlBtn} onClick={next} aria-label="Siguiente">
          <Icon name="SkipForward" size={32} filled />
        </button>
        <button
          className={styles.ctrlBtn}
          data-active={repeat !== 'off'}
          onClick={cycleRepeat}
          aria-label="Repetir"
        >
          <Icon name={repeat === 'one' ? 'Repeat1' : 'Repeat'} size={22} />
        </button>
      </div>

      <div className={styles.footer}>
        <button className={styles.footerBtn} aria-label="Dispositivos" disabled>
          <Icon name="Cast" size={20} />
        </button>
        <button
          className={styles.footerBtn}
          onClick={() => { toggleQueue(); handleClose(); }}
          aria-label="Cola"
        >
          <Icon name="ListMusic" size={20} />
        </button>
      </div>

      </div>{/* /.mainArea */}

      {/* Acerca del artista + Explora [Artist]. Solo se carga si hay
          artista — el ArtistInfoPanel decide internamente que mostrar.
          Posicionado tras .mainArea (con min-height ~100vh) de modo que
          solo asoma ~10% del titulo en el fold inicial, invitando al scroll. */}
      {hasArtistPanel && (
        <ArtistInfoPanel artistName={currentTrack.artist} />
      )}

      {saveOpen && currentTrack && (
        <SaveDialog track={currentTrack} onClose={() => setSaveOpen(false)} />
      )}

      {editOpen && currentTrack && (
        <EditTrackDialog track={currentTrack} onClose={() => setEditOpen(false)} />
      )}

      {shareToFriendOpen && currentTrack && (
        <ShareToFriendModal
          track={currentTrack}
          onClose={() => setShareToFriendOpen(false)}
        />
      )}
    </div>
  );
}

/** Cuerpo del bottom sheet de "Más opciones" del NowPlaying. */
function MoreMenuBody({ items }) {
  return (
    <div className={styles.moreMenu}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={styles.moreItem}
          disabled={it.disabled}
          onClick={it.onClick}
        >
          <Icon name={it.icon} size={18} />
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}
