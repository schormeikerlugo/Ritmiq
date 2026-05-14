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
import { useEffect } from 'react';
import { useArtistStore } from '../../stores/artist.js';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { Icon } from '../Icon/Icon.jsx';
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
  const fetchArtist = useArtistStore((s) => s.fetch);
  const details     = useArtistStore((s) => s.details[name]);
  const playNow     = usePlayerStore((s) => s.playNow);

  useEffect(() => {
    if (name) fetchArtist(name);
  }, [name, fetchArtist]);

  if (!details || details.loading) {
    return (
      <section className={styles.wrap}>
        <header className={styles.headerSkel}>
          <div className={styles.coverSkel} />
          <div className={styles.metaSkel}>
            <div className={styles.lineSkel} style={{ width: '60%', height: 28 }} />
            <div className={styles.lineSkel} style={{ width: '40%' }} />
          </div>
        </header>
      </section>
    );
  }

  if (details.error || !details.name) {
    return (
      <section className={styles.wrap}>
        <div className={styles.empty}>
          <Icon name="AlertCircle" size={32} />
          <p>No pudimos cargar la información de {name}.</p>
          {details.error && <p className={styles.errorMsg}>{details.error}</p>}
        </div>
      </section>
    );
  }

  const tracks = (details.topTracks ?? []).map((t) => topTrackToTrack(t, details.name));

  const playAll = () => {
    if (tracks.length === 0) return;
    playNow(tracks, 0);
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
        {/* TODO Fase D: guardar discografía completa */}
      </div>

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
