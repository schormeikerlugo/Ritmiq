/**
 * Página de artista estilo Spotify (Fase B).
 *
 * Estructura:
 *   ┌────────────────────────────────────────────────────┐
 *   │ Header con gradient + imagen artista grande        │
 *   │   Nombre + tags + N oyentes                        │
 *   │   [▶ Reproducir]  [+ Guardar discografía]          │
 *   ├────────────────────────────────────────────────────┤
 *   │ Top tracks (lista vertical, reproducible)          │
 *   ├────────────────────────────────────────────────────┤
 *   │ Discografía (grid de álbumes)                      │
 *   │   Click → expande tracklist (Fase C)               │
 *   ├────────────────────────────────────────────────────┤
 *   │ Bio + tags                                         │
 *   └────────────────────────────────────────────────────┘
 *
 * Fase C añadirá: click en álbum expande tracklist + botón "Reproducir
 * álbum" + "+ Guardar como playlist".
 */
import { useEffect, useState } from 'react';
import { useArtistStore } from '../../stores/artist.js';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { Icon } from '../Icon/Icon.jsx';
import { ConfirmDialog, ErrorState } from '../primitives/index.js';
import { HeroSkeleton, TrackRowSkeleton } from '../Skeleton/index.js';
import { toast } from '../../stores/toast.js';
import styles from './ArtistView.module.css';

function fmtListeners(n) {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDur(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/** Convierte un topTrack del payload en Track-like reproducible. */
function topTrackToTrack(t, artistName) {
  return {
    id: `yt:${t.ytId}`,
    userId: '',
    source: 'youtube',
    ytId: t.ytId,
    title: t.title,
    artist: t.artist ?? artistName,
    album: null,
    durationSeconds: t.duration ?? null,
    coverUrl: t.thumbnail ?? null,
    filePath: null,
    isDownloaded: false,
    createdAt: new Date().toISOString(),
  };
}

export function ArtistView({ name }) {
  const fetchArtist     = useArtistStore((s) => s.fetch);
  const details         = useArtistStore((s) => s.details[name]);
  const saveDiscography = useArtistStore((s) => s.saveDiscography);
  const discoSave       = useArtistStore((s) => s.discographySaves[name]);
  const playNow         = usePlayerStore((s) => s.playNow);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (name) fetchArtist(name);
  }, [name, fetchArtist]);

  if (!details || details.loading) {
    return (
      <section className={styles.wrap}>
        <HeroSkeleton />
        <TrackRowSkeleton count={5} />
      </section>
    );
  }

  if (details.error || !details.name) {
    return (
      <section className={styles.wrap}>
        <ErrorState
          title={`No pudimos cargar a ${name}`}
          message={details.error ?? 'Inténtalo de nuevo en unos segundos.'}
          onRetry={() => fetchArtist(name)}
        />
      </section>
    );
  }

  const tracks = (details.topTracks ?? []).map((t) => topTrackToTrack(t, details.name));

  const playAll = () => {
    if (tracks.length === 0) return;
    playNow(tracks, 0);
  };

  const albumCount = details.albums?.length ?? 0;
  const discoBusy = !!discoSave?.saving;

  // Confirm + ejecucion asincrona. ConfirmDialog cierra al terminar onConfirm,
  // pero el guardado real continua en background con el toast informando.
  // Si lanzamos sin await, el dialog se cierra inmediato y el usuario sigue
  // navegando; el progreso se observa via toast + estado en store.
  const handleSaveDiscography = () => {
    setConfirmOpen(false);
    const startedAt = Date.now();
    toast.info(`Guardando discografia de ${details.name}... (0 / ${albumCount})`, {
      duration: 0, // permanente hasta dismiss manual
      icon: 'Disc3',
    });
    saveDiscography(details.name).then((res) => {
      // Cerramos el toast persistente (todos los infos en pantalla) antes
      // del resumen \u2014 dismiss por id seria ideal pero no guardamos el id.
      // El nuevo toast empuja al anterior fuera por FIFO de MAX_VISIBLE=3
      // si hace falta. Pragmatico.
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      if (res.total === 0) {
        toast.error(`${details.name}: no hay albumes para guardar`);
      } else if (res.failed.length === 0) {
        toast.success(
          `${res.done} albumes guardados (${elapsed}s)`,
          { icon: 'Check' },
        );
      } else {
        toast.error(
          `${res.done - res.failed.length}/${res.total} guardados. Fallaron: ${res.failed.slice(0, 3).join(', ')}${res.failed.length > 3 ? '...' : ''}`,
          { duration: 6000 },
        );
      }
    }).catch((err) => {
      toast.error(`Error guardando discografia: ${err?.message ?? err}`);
    });
  };

  return (
    <section className={styles.wrap}>
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <header
        className={styles.header}
        style={details.image ? { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.4) 30%, rgba(0,0,0,0.85)), url(${details.image})` } : undefined}
      >
        <div className={styles.headerInner}>
          <div className={styles.kind}>Artista</div>
          <h1 className={styles.name}>{details.name}</h1>
          {details.tags?.length > 0 && (
            <div className={styles.tags}>
              {details.tags.map((t) => (
                <span key={t} className={styles.tag}>{t}</span>
              ))}
            </div>
          )}
          {details.listeners ? (
            <p className={styles.listeners}>{fmtListeners(details.listeners)} oyentes en Last.fm</p>
          ) : null}
        </div>
      </header>

      {/* ─── Actions ────────────────────────────────────────────────── */}
      <div className={styles.actions}>
        <button
          className={styles.playBtn}
          onClick={playAll}
          disabled={tracks.length === 0}
        >
          <Icon name="Play" size={18} filled />
          <span>Reproducir</span>
        </button>
        {albumCount > 0 && (
          <button
            className={styles.secondaryBtn}
            onClick={() => setConfirmOpen(true)}
            disabled={discoBusy}
            title={discoBusy
              ? `Guardando... ${discoSave.done}/${discoSave.total}`
              : `Guardar ${albumCount} albumes como playlists`}
          >
            <Icon name={discoBusy ? 'Loader' : 'Plus'} size={16} />
            <span>
              {discoBusy
                ? `Guardando ${discoSave.done}/${discoSave.total}`
                : 'Guardar discografia'}
            </span>
          </button>
        )}
      </div>

      {confirmOpen && (
        <ConfirmDialog
          title={`Guardar discografia de ${details.name}`}
          icon="Disc3"
          confirmLabel={`Guardar ${albumCount} albumes`}
          cancelLabel="Cancelar"
          variant="primary"
          body={
            <>
              <p>
                Se crearan {albumCount} playlists en tu biblioteca, una por
                cada album. Cada playlist se rellena con los tracks del album
                resueltos a YouTube.
              </p>
              <p style={{ marginTop: 8, color: 'var(--color-text-muted)', fontSize: 'var(--fs-xs)' }}>
                El proceso puede tardar varios minutos. Puedes seguir
                navegando mientras se guarda; el progreso se muestra como
                toast.
              </p>
            </>
          }
          onConfirm={handleSaveDiscography}
          onClose={() => setConfirmOpen(false)}
        />
      )}

      {/* ─── Top tracks ─────────────────────────────────────────────── */}
      {tracks.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Top canciones</h2>
          <ol className={styles.trackList}>
            {tracks.map((t, i) => (
              <li key={t.ytId}>
                <button className={styles.trackRow} onClick={() => playNow(tracks, i)}>
                  <span className={styles.trackIdx}>{i + 1}</span>
                  <div className={styles.trackCover}>
                    {t.coverUrl
                      ? <img src={t.coverUrl} alt="" loading="lazy" />
                      : <Icon name="Music" size={16} />}
                    <span className={styles.trackPlay} aria-hidden="true">
                      <Icon name="Play" size={14} filled />
                    </span>
                  </div>
                  <span className={styles.trackTitle}>{t.title}</span>
                  {t.durationSeconds ? (
                    <span className={styles.trackDur}>{fmtDur(t.durationSeconds)}</span>
                  ) : <span />}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ─── Discografía ────────────────────────────────────────────── */}
      {details.albums?.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Discografía</h2>
          <div className={styles.albumGrid}>
            {details.albums.map((al) => (
              <AlbumThumb
                key={al.title}
                artist={details.name}
                album={al}
              />
            ))}
          </div>
        </section>
      )}

      {/* ─── Bio ─────────────────────────────────────────────────────── */}
      {details.bio && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Acerca de</h2>
          <p className={styles.bio}>{details.bio}</p>
        </section>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* AlbumThumb — card simple, click navega a la vista de álbum dedicada     */
/* ────────────────────────────────────────────────────────────────────── */

function AlbumThumb({ artist, album }) {
  const goAlbum = useViewStore((s) => s.goAlbum);
  return (
    <button
      type="button"
      className={styles.albumThumb}
      onClick={() => goAlbum(artist, album.title)}
      aria-label={`Abrir álbum ${album.title}`}
    >
      <div className={styles.albumCover}>
        {album.coverUrl
          ? <img src={album.coverUrl} alt="" loading="lazy" />
          : <Icon name="Disc3" size={28} />}
      </div>
      <div className={styles.albumMeta}>
        <span className={styles.albumTitle}>{album.title}</span>
        <span className={styles.albumSub}>
          {album.year ? `${album.year} · Álbum` : 'Álbum'}
        </span>
      </div>
    </button>
  );
}
