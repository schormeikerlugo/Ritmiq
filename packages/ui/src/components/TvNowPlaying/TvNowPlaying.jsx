/**
 * Pantalla "Reproduciendo" de la app de TV (sustituye al panel lateral
 * NowPlaying cuando IS_TV). Pantalla completa: imagen grande del vídeo de
 * fondo, portada + título abajo a la izquierda, play y barra de progreso,
 * controles. Letras = letra a pantalla completa estilo karaoke (TvLyrics);
 * A continuación / Artista = panel lateral dentro de la misma pantalla.
 *
 * Mando: ←/→ en la barra = ±10 s; Atrás cierra el panel y luego la pantalla;
 * tras 8 s sin teclas (sonando y sin panel) entra en reposo (se ocultan los
 * controles) y la primera tecla solo la despierta (lib/tv-nav.js
 * setTvKeyInterceptor).
 *
 * @module @ritmiq/ui/components/TvNowPlaying
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { usePlaylistsStore } from '../../stores/playlists.js';
import { useLibraryStore } from '../../stores/library.js';
import { useJamStore } from '../../stores/jam.js';
import { isEphemeralTrack } from '../../lib/track-helpers.js';
import { tvFocus, setTvKeyInterceptor } from '../../lib/tv-nav.js';
import { Icon } from '../Icon/Icon.jsx';
import { TvLyrics } from './TvLyrics.jsx';
import { ArtistInfoPanel } from '../NowPlaying/ArtistInfoPanel.jsx';
import { TvConnectBlock } from '../Jam/TvConnect.jsx';
import { TrackImg } from '../primitives/TrackImg.jsx';
import { useArtistImage } from '../../lib/track-art.js';
import { useArtStore } from '../../stores/art.js';
import styles from './TvNowPlaying.module.css';

const IDLE_MS = 8000;
const SEEK_STEP = 10;

function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** Fondo sin foto de artista: la miniatura máxima de YouTube; si no, la portada. */
function backdropOf(track) {
  if (track?.ytId) return `https://i.ytimg.com/vi/${track.ytId}/maxresdefault.jpg`;
  return track?.coverUrl ?? null;
}

function seekTo(seconds) {
  usePlayerStore.getState().patch({ positionSeconds: seconds });
  window.dispatchEvent(new CustomEvent('ritmiq:seek', { detail: { seconds } }));
}

export function TvNowPlaying() {
  const close = useViewStore((s) => s.closeNowPlaying);
  const lyricsOpen = useViewStore((s) => s.lyricsOpen);
  const setLyricsOpen = useViewStore((s) => s.setLyricsOpen);

  const track = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const position = usePlayerStore((s) => s.positionSeconds);
  const duration = usePlayerStore((s) => s.durationSeconds) || track?.durationSeconds || 0;
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const queueContext = usePlayerStore((s) => s.queueContext);
  const { togglePlay, next, prev, toggleShuffle, cycleRepeat } = usePlayerStore.getState();

  const playlists = usePlaylistsStore((s) => s.playlists);
  const favoritesId = usePlaylistsStore((s) => s.favoritesId);
  const isFavorite = usePlaylistsStore((s) => s.isFavorite);
  const addTrack = usePlaylistsStore((s) => s.addTrack);
  const toggleFavorite = usePlaylistsStore((s) => s.toggleFavorite);
  const persistEphemeral = useLibraryStore((s) => s.persistEphemeral);

  // Panel lateral: 'lyrics' | 'queue' | 'artist' | null. Letras se guarda en
  // el store de vistas (el botón de letra de la barra abre esta pantalla así).
  const [side, setSide] = useState(lyricsOpen ? 'lyrics' : null);
  const [idle, setIdle] = useState(false);
  // Fondo: foto del artista (portadas oficiales, lib/track-art.js); sin ella,
  // el fotograma del vídeo como antes.
  const artistImage = useArtistImage(track);
  // Título/artista limpios si el servidor identificó la canción (sin
  // "(Official Video)", "Artista - …"). Solo para mostrar.
  const artEntry = useArtStore((s) => (track?.ytId ? s.entries[track.ytId] : null));
  const showTitle = artEntry?.s === 'found' && artEntry.t ? artEntry.t : track?.title;
  const showArtist = artEntry?.s === 'found' && artEntry.ar ? artEntry.ar : track?.artist;
  const [bgSrc, setBgSrc] = useState(() => artistImage ?? backdropOf(track));
  const rootRef = useRef(null);
  const playRef = useRef(null);
  const sideRef = useRef(null);
  const idleTimer = useRef(null);

  useEffect(() => { setBgSrc(artistImage ?? backdropOf(track)); }, [track?.ytId, track?.coverUrl, artistImage]);
  useEffect(() => { setLyricsOpen(side === 'lyrics'); }, [side, setLyricsOpen]);

  // Foco inicial en play; al cerrar, devolverlo a donde estaba.
  useEffect(() => {
    const before = document.activeElement;
    const t = setTimeout(() => tvFocus(playRef.current), 50);
    return () => {
      clearTimeout(t);
      if (before && document.contains(before)) tvFocus(before);
    };
  }, []);

  // Reposo.
  const idleRef = useRef(idle);
  idleRef.current = idle;
  const armIdle = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      const p = usePlayerStore.getState();
      // Reposo sin panel o con la letra (para leerla sin controles encima).
      if (p.isPlaying && (!sideRef.current || sideRef.current === 'lyrics')) setIdle(true);
    }, IDLE_MS);
  }, []);
  sideRef.current = side;
  useEffect(() => {
    armIdle();
    const off = setTvKeyInterceptor((e) => {
      // Otra ventana encima (p. ej. la del código): no tocar sus teclas.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== rootRef.current) return false;
      armIdle();
      if (idleRef.current) { setIdle(false); return true; }
      return false;
    });
    return () => { off(); clearTimeout(idleTimer.current); };
  }, [armIdle]);
  useEffect(() => { if (!isPlaying) setIdle(false); else armIdle(); }, [isPlaying, armIdle]);

  // Atrás (Escape sintético de App.jsx): panel → pantalla.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== rootRef.current) return;
      e.preventDefault();
      if (sideRef.current) setSide(null);
      else close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  // Al abrir un panel con lista, foco en su primer elemento.
  useEffect(() => {
    if (side !== 'queue') return;
    const t = setTimeout(() => {
      const first = rootRef.current?.querySelector('[data-side] button');
      if (first) tvFocus(first);
    }, 50);
    return () => clearTimeout(t);
  }, [side]);

  if (!track) return null;

  const ephemeral = isEphemeralTrack(track);
  const fav = !ephemeral && isFavorite(track.id);
  const onHeart = async () => {
    let id = track.id;
    if (ephemeral) id = (await persistEphemeral(track)).id;
    if (favoritesId && !isFavorite(id)) await addTrack(favoritesId, id);
    else if (favoritesId) await toggleFavorite(id);
  };

  const from = queueContext?.kind === 'playlist'
    ? playlists.find((p) => p.id === queueContext.playlistId)?.name
    : null;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  const onSeekKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const d = e.key === 'ArrowRight' ? SEEK_STEP : -SEEK_STEP;
    seekTo(Math.max(0, Math.min(duration || 0, position + d)));
  };
  const toggleSide = (id) => setSide((s) => (s === id ? null : id));

  return createPortal(
    <div
      ref={rootRef}
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-label="Reproduciendo"
      data-idle={idle || undefined}
      data-panel={side && side !== 'lyrics' ? side : undefined}
      data-lyrics={side === 'lyrics' || undefined}
    >
      {bgSrc && (
        <img
          className={styles.bg}
          src={bgSrc}
          alt=""
          data-artist={bgSrc === artistImage || undefined}
          onError={() => {
            if (bgSrc === artistImage) setBgSrc(backdropOf(track));
            else if (bgSrc !== track.coverUrl) setBgSrc(track.coverUrl ?? null);
          }}
        />
      )}
      <div className={styles.shade} aria-hidden="true" />
      {side === 'lyrics' && <TvLyrics track={track} idle={idle} />}
      {side === 'lyrics' && (
        <div className={styles.lyricsHead}>
          {track.coverUrl
            ? <TrackImg className={styles.lyricsHeadCover} track={track} />
            : <span className={styles.lyricsHeadCover}><Icon name="Music" size={22} /></span>}
          <span className={styles.lyricsHeadText}>
            <span className={styles.lyricsHeadTitle}>{showTitle}</span>
            <span className={styles.lyricsHeadArtist}>{showArtist ?? ''}</span>
          </span>
        </div>
      )}

      <header className={styles.top}>
        <span className={styles.from}>
          <Icon name="Music2" size={16} />
          {from ? <>Reproduciendo desde <strong>{from}</strong></> : 'Reproduciendo'}
        </span>
        <TvConnectBlock />
      </header>

      <section className={styles.bottom}>
        <div className={styles.meta}>
          {track.coverUrl
            ? <TrackImg className={styles.cover} track={track} size={1000} priority />
            : <span className={styles.cover}><Icon name="Music" size={40} /></span>}
          <div className={styles.titles}>
            <h1 className={styles.title}>{showTitle}</h1>
            <p className={styles.artist}>{showArtist ?? '—'}</p>
          </div>
        </div>

        <div className={styles.progressRow}>
          <button
            ref={playRef}
            type="button"
            className={styles.play}
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
            data-primary
          >
            <Icon name={isPlaying ? 'Pause' : 'Play'} size={26} filled />
          </button>
          <div className={styles.progressWrap}>
            <div
              className={styles.bar}
              role="slider"
              tabIndex={0}
              aria-label="Posición (← → 10 s)"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(position)}
              onKeyDown={onSeekKey}
            >
              <span className={styles.fill} style={{ width: `${pct}%` }} />
              <span className={styles.knob} style={{ left: `${pct}%` }} />
            </div>
            <div className={styles.times}>
              <span>{fmt(position)}</span>
              <span>-{fmt(Math.max(0, duration - position))}</span>
            </div>
          </div>
        </div>

        <div className={styles.controls}>
          <div className={styles.group}>
            <button type="button" className={styles.ctrl} onClick={prev} aria-label="Anterior">
              <Icon name="SkipBack" size={22} filled />
            </button>
            {/* Modo letra: el play va aquí, entre anterior y siguiente, y la
                barra de tiempo ocupa todo el ancho (como en la referencia). */}
            {side === 'lyrics' && (
              <button type="button" className={`${styles.ctrl} ${styles.ctrlPlay}`} onClick={togglePlay} aria-label={isPlaying ? 'Pausar' : 'Reproducir'}>
                <Icon name={isPlaying ? 'Pause' : 'Play'} size={24} filled />
              </button>
            )}
            <button type="button" className={styles.ctrl} onClick={next} aria-label="Siguiente">
              <Icon name="SkipForward" size={22} filled />
            </button>
            <button type="button" className={styles.ctrl} data-on={shuffle || undefined} onClick={toggleShuffle} aria-label="Aleatorio">
              <Icon name="Shuffle" size={20} />
            </button>
            <button type="button" className={styles.ctrl} data-on={repeat !== 'off' || undefined} onClick={cycleRepeat} aria-label="Repetir">
              <Icon name={repeat === 'one' ? 'Repeat1' : 'Repeat'} size={20} />
            </button>
            <button type="button" className={styles.ctrl} data-on={fav || undefined} onClick={onHeart} aria-label={fav ? 'Quitar de favoritos' : 'Añadir a favoritos'}>
              <Icon name="Heart" size={20} filled={fav} />
            </button>
          </div>
          <div className={styles.group}>
            <button type="button" className={styles.pill} data-on={side === 'lyrics' || undefined} onClick={() => toggleSide('lyrics')}>
              <Icon name="Music" size={18} /> Letras
            </button>
            <button type="button" className={styles.pill} data-on={side === 'queue' || undefined} onClick={() => toggleSide('queue')}>
              <Icon name="ListMusic" size={18} /> A continuación
            </button>
            {track.artist && (
              <button type="button" className={styles.pill} data-on={side === 'artist' || undefined} onClick={() => toggleSide('artist')}>
                <Icon name="User" size={18} /> Artista
              </button>
            )}
          </div>
        </div>
      </section>

      {side && side !== 'lyrics' && (
        <aside className={styles.side} data-side={side}>
          {side === 'queue' && <UpNext />}
          {side === 'artist' && (
            <div className={styles.artist2} inert="">
              <ArtistInfoPanel artistName={track.artist} />
            </div>
          )}
        </aside>
      )}
    </div>,
    document.body,
  );
}

/** Cola: primero lo añadido desde los teléfonos (jam), luego la cola normal. */
function UpNext() {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const playAt = usePlayerStore((s) => s.playAt);
  const suggestions = useJamStore((s) => s.suggestions);
  const profilesById = useJamStore((s) => s.profilesById);
  const playSuggestion = useJamStore((s) => s.playSuggestion);

  const added = suggestions.filter((s) => !s.playedAt).sort((a, b) => a.position - b.position);
  const upcoming = queue.slice(index + 1, index + 31).map((t, i) => ({ t, i: index + 1 + i }));

  return (
    <div className={styles.queue}>
      {added.length > 0 && (
        <>
          <h2 className={styles.sideTitle}>Añadidas desde los móviles</h2>
          <ul className={styles.list}>
            {added.map((s) => {
              const who = profilesById?.[s.suggestedBy];
              return (
                <li key={s.id}>
                  <button type="button" className={styles.item} onClick={() => playSuggestion(s.id)}>
                    <Thumb track={s.track} />
                    <span className={styles.itemText}>
                      <span className={styles.itemTitle}>{s.track?.title}</span>
                      <span className={styles.itemSub}>
                        {s.track?.artist ?? ''}{who ? ` · añadida por ${who.displayName || who.username}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <h2 className={styles.sideTitle}>A continuación</h2>
      {upcoming.length === 0 ? (
        <p className={styles.empty}>No hay más canciones en la cola.</p>
      ) : (
        <ul className={styles.list}>
          {upcoming.map(({ t, i }) => (
            <li key={`${t.id ?? t.ytId}-${i}`}>
              <button type="button" className={styles.item} onClick={() => playAt(i)}>
                <Thumb track={t} />
                <span className={styles.itemText}>
                  <span className={styles.itemTitle}>{t.title}</span>
                  <span className={styles.itemSub}>{t.artist ?? ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Thumb({ track }) {
  return track?.coverUrl
    ? <TrackImg className={styles.thumb} track={track} loading="lazy" />
    : <span className={styles.thumb}><Icon name="Music" size={18} /></span>;
}
