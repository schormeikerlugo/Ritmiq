/**
 * Página dedicada de álbum (Fase C — refactor).
 *
 * Estructura:
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [← Atrás]                                            │
 *   │ Cover grande  |  Álbum · 1994 · N canciones · Artista│
 *   │              [▶ Reproducir]  [+ Guardar como playlist]│
 *   ├──────────────────────────────────────────────────────┤
 *   │ Lista numerada de tracks                              │
 *   ├──────────────────────────────────────────────────────┤
 *   │ Otros álbumes de <Artista> (grid de thumbs)          │
 *   └──────────────────────────────────────────────────────┘
 */
import { useEffect } from 'react';
import { useArtistStore } from '../../stores/artist.js';
import { usePlayerStore } from '../../stores/player.js';
import { useViewStore } from '../../stores/view.js';
import { prewarmStream } from '../../lib/lan-client.js';
import { Icon } from '../Icon/Icon.jsx';
import styles from './AlbumView.module.css';

function albumKey(artist, album) {
  return `${(artist ?? '').toLowerCase()}::${(album ?? '').toLowerCase()}`;
}

function fmtDur(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

export function AlbumView({ artist, album }) {
  const resolveAlbum   = useArtistStore((s) => s.resolveAlbum);
  const fetchArtist    = useArtistStore((s) => s.fetch);
  const saveAsPlaylist = useArtistStore((s) => s.saveAlbumAsPlaylist);
  const albumData      = useArtistStore((s) => s.albums[albumKey(artist, album)]);
  const saveState      = useArtistStore((s) => s.saves[albumKey(artist, album)]);
  const artistData     = useArtistStore((s) => s.details[artist]);
  const playNow        = usePlayerStore((s) => s.playNow);
  const goBack         = useViewStore((s) => s.goBack);
  const goAlbum        = useViewStore((s) => s.goAlbum);
  const goArtist       = useViewStore((s) => s.goArtist);
  const goPlaylist     = useViewStore((s) => s.goPlaylist);

  // Carga del álbum + de la lista de "otros álbumes" del artista.
  useEffect(() => {
    if (artist && album) resolveAlbum(artist, album);
  }, [artist, album, resolveAlbum]);
  useEffect(() => {
    if (artist && !artistData?.name) fetchArtist(artist);
  }, [artist, artistData?.name, fetchArtist]);

  const loading = albumData?.loading || (!albumData && !albumData?.error);
  const tracks = (albumData?.tracks ?? []).map((t) => ({
    id: `yt:${t.ytId}`,
    userId: '',
    source: 'youtube',
    ytId: t.ytId,
    title: t.title,
    artist: t.artist ?? artist,
    album,
    durationSeconds: t.duration ?? null,
    coverUrl: t.thumbnail ?? albumData?.coverUrl ?? null,
    filePath: null,
    isDownloaded: false,
    createdAt: new Date().toISOString(),
  }));

  // Prewarm de los primeros 3 tracks: yt-dlp + signature solving tarda
  // ~4s en frío. Disparándolo apenas el álbum aparece, cuando el usuario
  // pulse play en cualquiera de los primeros tracks la URL ya está cacheada
  // en el LAN server. Latencia percibida ≈ 0.
  useEffect(() => {
    // Reducido de 3 -> 1: con MAX_CONCURRENT=3 en el desktop, prewarmear
    // 3 tracks dejaba 0 slots para el click real, bloqueando ~6s. Con 1,
    // el slot mas probable (la 1a cancion) calienta y los otros 2 quedan
    // libres para click o background download.
    const ytIds = tracks.slice(0, 1).map((t) => t.ytId).filter(Boolean);
    for (const id of ytIds) prewarmStream(id);
    // tracks viene de map() — recalculado en cada render. Dependemos del
    // identificador estable de los primeros tracks para evitar re-prewarms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks[0]?.ytId, tracks[1]?.ytId, tracks[2]?.ytId]);

  const playAlbum = (startIdx = 0) => {
    if (tracks.length === 0) return;
    playNow(tracks, Math.min(startIdx, tracks.length - 1));
  };

  const handleSave = async () => {
    if (saveState?.saving || tracks.length === 0) return;
    const playlistId = await saveAsPlaylist({
      artist,
      album,
      coverUrl: albumData?.coverUrl,
      tracks: albumData.tracks,
    });
    if (playlistId) goPlaylist(playlistId);
  };

  const otherAlbums = (artistData?.albums ?? []).filter(
    (al) => al.title.toLowerCase() !== album.toLowerCase()
  );

  return (
    <section className={styles.wrap}>
      <button type="button" className={styles.back} onClick={goBack}>
        <Icon name="ChevronLeft" size={16} />
        <span>Atrás</span>
      </button>

      {/* ─── Hero ─────────────────────────────────────────────────────── */}
      <header className={styles.hero}>
        <div className={styles.cover}>
          {albumData?.coverUrl
            ? <img src={albumData.coverUrl} alt="" />
            : <Icon name="Disc3" size={56} />}
        </div>
        <div className={styles.heroMeta}>
          <div className={styles.kind}>Álbum</div>
          <h1 className={styles.title}>{album}</h1>
          <p className={styles.byline}>
            <button className={styles.artistLink} onClick={() => goArtist(artist)}>
              {artist}
            </button>
            {albumData?.year && <span> · {albumData.year}</span>}
            {tracks.length > 0 && <span> · {tracks.length} canciones</span>}
          </p>
          <div className={styles.actions}>
            <button
              className={styles.playBtn}
              onClick={() => playAlbum(0)}
              disabled={tracks.length === 0}
            >
              <Icon name="Play" size={16} filled />
              <span>Reproducir</span>
            </button>
            <button
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={tracks.length === 0 || !!saveState?.saving}
            >
              <Icon name="Plus" size={14} />
              <span>
                {saveState?.saving
                  ? `Guardando ${saveState.progress}%…`
                  : 'Guardar como playlist'}
              </span>
            </button>
          </div>
          {saveState?.error && <p className={styles.errorMsg}>{saveState.error}</p>}
        </div>
      </header>

      {/* ─── Tracklist ───────────────────────────────────────────────── */}
      <section className={styles.section}>
        {loading && (
          <p className={styles.status}>Resolviendo tracklist…</p>
        )}
        {albumData?.error && (
          <p className={styles.status}>No se pudo cargar este álbum.</p>
        )}
        {tracks.length > 0 && (
          <ol className={styles.trackList}>
            {tracks.map((t, i) => (
              <li key={t.ytId}>
                <button className={styles.trackRow} onClick={() => playAlbum(i)}>
                  <span className={styles.trackIdx}>{i + 1}</span>
                  <span className={styles.trackTitle}>{t.title}</span>
                  {t.durationSeconds ? (
                    <span className={styles.trackDur}>{fmtDur(t.durationSeconds)}</span>
                  ) : <span />}
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ─── Otros álbumes del artista ───────────────────────────────── */}
      {otherAlbums.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Otros álbumes de {artist}</h2>
          <div className={styles.albumGrid}>
            {otherAlbums.map((al) => (
              <button
                key={al.title}
                type="button"
                className={styles.albumThumb}
                onClick={() => goAlbum(artist, al.title)}
                aria-label={`Abrir álbum ${al.title}`}
              >
                <div className={styles.thumbCover}>
                  {al.coverUrl
                    ? <img src={al.coverUrl} alt="" loading="lazy" />
                    : <Icon name="Disc3" size={24} />}
                </div>
                <div className={styles.thumbMeta}>
                  <span className={styles.thumbTitle}>{al.title}</span>
                  <span className={styles.thumbSub}>
                    {al.year ? `${al.year} · Álbum` : 'Álbum'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
